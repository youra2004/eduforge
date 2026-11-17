import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessments,
  consents,
  courseVersions,
  createDb,
  llmRuns,
  nodeProgress,
  proctorEvents,
  proctorEvidence,
  questions,
  strikes,
  users,
} from '@eduforge/db';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/guard';
import { recordConsent } from '../auth/consent';
import { loadConfig } from '../config';
import { CourseError } from '../courses/errors';
import { getVersionGraph, importCourse } from '../courses/service';
import {
  examSettings,
  getExam,
  interruptExam,
  startExam,
  type ExamSettings,
} from '../exam/service';
import { enroll } from '../learning/service';
import { purgeExpiredEvidence } from './evidence';
import { MockProctorProvider } from './provider';
import { checkSnapshot, reportEvents } from './service';
import {
  appealStrike,
  getEvidenceFrame,
  listOwnStrikes,
  listStrikeQueue,
  resolveAppeal,
  reviewSoftStrike,
} from './strikes';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);
const T0 = new Date('2026-03-01T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const DAY = 24 * 60 * 60;

// A tiny JPEG-looking payload: the mock provider never decodes it, the server only checks the magic bytes.
const jpeg = (seed: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`frame-${seed}`)]).toString(
    'base64',
  );
const REF = jpeg('reference');

let storageDir: string;
let settings: ExamSettings;
const provider = new MockProctorProvider();
let n = 0;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'eduforge-proctor-'));
  const base = examSettings(loadConfig({ DATABASE_URL: 'x' }));
  settings = {
    ...base,
    proctor: {
      ...base.proctor,
      storageDir,
      evidenceKey: randomBytes(32).toString('hex'),
      snapshotIntervalSeconds: 60,
    },
  };
});

async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `proctor-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning();
  return { id: row!.id, email, displayName: 'Тест', roles };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError) return err.code;
    throw err;
  }
  return 'ok';
}

/** A published course whose student passed every node and gave the proctoring consent. */
async function setup(existing?: AuthUser) {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(demo), slug: `proctor-${Date.now()}-${n++}` },
    author.id,
  );
  await db
    .update(courseVersions)
    .set({ status: 'published', rating: 2 })
    .where(eq(courseVersions.id, versionId));
  const graph = await getVersionGraph(db, author, versionId);
  for (const node of graph.nodes) {
    for (const skillId of node.skillIds) {
      await db.insert(questions).values(
        Array.from({ length: 2 }, (_, i) => ({
          nodeId: node.id,
          skillId,
          pool: 'exam' as const,
          kind: 'mcq' as const,
          promptMd: `Питання ${i}`,
          options: ['Невірно', 'Вірно', 'Теж невірно', 'І це невірно'],
          answerKey: { optionIndex: 1 },
          guess: 0.25,
          status: 'validated' as const,
        })),
      );
    }
  }
  const student = existing ?? (await makeUser(['student']));
  await enroll(db, student, versionId);
  const ids = graph.nodes.map((x) => x.id);
  await db
    .update(nodeProgress)
    .set({ state: 'passed', passedAt: T0 })
    .where(and(eq(nodeProgress.userId, student.id), inArray(nodeProgress.nodeId, ids)));
  if (!existing) await recordConsent(db, student.id, 'proctoring');
  return { author, student, versionId };
}

/** Starts the exam and passes the camera gate. */
async function running(student: AuthUser, versionId: string, now = T0) {
  const view = await startExam(db, student, versionId, settings, now);
  await reportEvents(
    db,
    student,
    view.id,
    { events: [{ type: 'camera_ready' }] },
    settings.proctor,
    now,
  );
  return view.id;
}

const events = (examId: string) =>
  db
    .select()
    .from(proctorEvents)
    .where(eq(proctorEvents.assessmentId, examId))
    .orderBy(proctorEvents.ts);
const strikeOf = async (examId: string) =>
  (await db.select().from(strikes).where(eq(strikes.assessmentId, examId)))[0];
const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!;
const evidenceFiles = () => {
  const dir = join(storageDir, 'evidence');
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe('consent and the camera gate (F9-R1, D-27)', () => {
  it('the exam does not start without the proctoring consent', async () => {
    const { student, versionId } = await setup();
    await db.delete(consents).where(eq(consents.userId, student.id));
    expect(await code(startExam(db, student, versionId, settings, T0))).toBe('consent_required');
    await recordConsent(db, student.id, 'proctoring');
    expect(await code(startExam(db, student, versionId, settings, T0))).toBe('ok');
  });

  it('no question leaves the server and no answer is taken until the camera is ready', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    expect(view.current).toBeNull();
    expect(view.proctor).toMatchObject({ enabled: true, ready: false });
    await reportEvents(
      db,
      student,
      view.id,
      { events: [{ type: 'camera_ready' }] },
      settings.proctor,
      at(2),
    );
    const ready = await getExam(db, student, view.id, settings, at(3));
    expect(ready.proctor.ready).toBe(true);
    expect(ready.current?.question).toBeTruthy();
  });
});

describe('hard events (F9-R2, D-19)', () => {
  it.each(['fullscreen_exit', 'devtools_open', 'copy', 'paste'])(
    '%s stops the attempt and creates a confirmed strike with a 7-day ban',
    async (type) => {
      const { student, versionId } = await setup();
      const id = await running(student, versionId);
      await reportEvents(db, student, id, { events: [{ type }] }, settings.proctor, at(30));
      const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
      expect(a).toMatchObject({
        status: 'annulled',
        meta: { reason: 'proctor_violation', violation: type },
      });
      const strike = await strikeOf(id);
      expect(strike).toMatchObject({ status: 'confirmed', level: 1, reason: type });
      expect(strike!.banUntil).toEqual(at(30 + 7 * DAY));
      expect((await userRow(student.id)).examBanUntil).toEqual(at(30 + 7 * DAY));
      expect(await code(startExam(db, student, versionId, settings, at(31)))).toBe('exam_banned');
      expect((await getExam(db, student, id, settings, at(31))).violation).toMatchObject({
        status: 'confirmed',
        level: 1,
        canAppeal: true,
      });
    },
  );

  it("losing focus counts only after the grace period; the severity is the server's, not the client's", async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'focus_lost', payload: { awayMs: 1000, severity: 'hard' } }] },
      settings.proctor,
      at(10),
    );
    expect(await strikeOf(id)).toBeUndefined();
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'focus_lost', payload: { awayMs: 4000 } }] },
      settings.proctor,
      at(20),
    );
    expect((await strikeOf(id))?.status).toBe('confirmed');
  });

  it('the browser cannot report a server-side type', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    expect(
      await code(
        reportEvents(
          db,
          student,
          id,
          { events: [{ type: 'face_mismatch' }] },
          settings.proctor,
          at(5),
        ),
      ),
    ).toBe('invalid_proctor_event');
    expect(
      await code(
        reportEvents(
          db,
          student,
          id,
          { events: [{ type: 'strike_created' }] },
          settings.proctor,
          at(5),
        ),
      ),
    ).toBe('invalid_proctor_event');
  });

  it("events about another student's exam are refused", async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const other = await makeUser(['student']);
    expect(
      await code(
        reportEvents(db, other, id, { events: [{ type: 'copy' }] }, settings.proctor, at(5)),
      ),
    ).toBe('assessment_not_found');
  });

  it('the ladder: 1st, 2nd, 3rd confirmed strike give 7 days, 30 days, for good; the ban is for exams only', async () => {
    const first = await setup();
    const student = first.student;
    const courses = [
      first.versionId,
      (await setup(student)).versionId,
      (await setup(student)).versionId,
    ];
    // Each strike comes after the ban of the one before has passed.
    const times = [T0, at(8 * DAY), at(40 * DAY)];
    const wanted = [
      { until: at(7 * DAY), forever: false },
      { until: at(8 * DAY + 30 * DAY), forever: false },
      { until: null, forever: true },
    ];
    for (const [i, versionId] of courses.entries()) {
      const id = await running(student, versionId, times[i]!);
      await reportEvents(
        db,
        student,
        id,
        { events: [{ type: 'copy' }] },
        settings.proctor,
        times[i],
      );
      expect((await strikeOf(id))!.level).toBe(i + 1);
      const row = await userRow(student.id);
      expect(row.examBanUntil).toEqual(wanted[i]!.until);
      expect(row.examBannedForever).toBe(wanted[i]!.forever);
      expect(
        await code(
          startExam(db, student, versionId, settings, new Date(times[i]!.getTime() + 1000)),
        ),
      ).toBe('exam_banned');
    }
    // The permanent ban never lapses; learning is untouched (the graph and node progress stay readable).
    expect(await code(startExam(db, student, courses[0]!, settings, at(900 * DAY)))).toBe(
      'exam_banned',
    );
    expect((await getVersionGraph(db, student, courses[0]!)).nodes.length).toBeGreaterThan(0);
  });
});

describe('soft signals go to an admin (F9-R3)', () => {
  it('a bad frame adds to the risk score and opens a pending strike without a ban or a stop', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const res = await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame: jpeg('a'), reference: REF, scenario: 'other_face' },
      settings.proctor,
      at(60),
    );
    expect(res).toMatchObject({ checked: true, events: ['face_mismatch'] });
    const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
    expect(a!.status).toBe('in_progress');
    expect(a!.riskScore).toBe(60);
    expect(await strikeOf(id)).toMatchObject({ status: 'pending_review', level: 0 });
    const row = await userRow(student.id);
    expect(row.examBanUntil).toBeNull();
    expect(row.examBannedForever).toBe(false);
    // The student sees nothing of an unconfirmed flag.
    expect(await listOwnStrikes(db, student)).toEqual([]);
  });

  it('a mild signal alone creates no strike', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'face_missing' }, { type: 'head_turn' }] },
      settings.proctor,
      at(20),
    );
    expect(await strikeOf(id)).toBeUndefined();
    const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
    expect(a!.riskScore).toBe(25);
  });

  it('soft signals add up past the threshold into one pending strike', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'multiple_faces' }] },
      settings.proctor,
      at(10),
    );
    expect(await strikeOf(id)).toBeUndefined();
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'multiple_faces' }] },
      settings.proctor,
      at(20),
    );
    expect((await strikeOf(id))?.status).toBe('pending_review');
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'multiple_faces' }] },
      settings.proctor,
      at(30),
    );
    expect(await db.select().from(strikes).where(eq(strikes.assessmentId, id))).toHaveLength(1);
  });

  it('a hard event after a soft flag confirms that same strike instead of adding a second one', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame: jpeg('e'), reference: REF, scenario: 'other_face' },
      settings.proctor,
      at(60),
    );
    const flagged = (await strikeOf(id))!;
    expect(flagged.status).toBe('pending_review');
    await reportEvents(db, student, id, { events: [{ type: 'paste' }] }, settings.proctor, at(90));
    const rows = await db.select().from(strikes).where(eq(strikes.assessmentId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: flagged.id,
      status: 'confirmed',
      level: 1,
      reason: 'paste',
    });
    expect((await userRow(student.id)).examBanUntil).toEqual(at(90 + 7 * DAY));
  });

  it('typing signals are soft, keep no characters, and never ban by themselves', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(
      db,
      student,
      id,
      {
        events: [
          {
            type: 'keystroke',
            payload: { intervalsMs: Array(30).fill(15), corrections: 0, chars: 400, keys: 30 },
          },
        ],
      },
      settings.proctor,
      at(40),
    );
    const log = (await events(id)).filter((e) => e.source === 'keystroke');
    expect(log.map((e) => e.type).sort()).toEqual(['keystroke_paste', 'keystroke_too_fast']);
    expect(JSON.stringify(log.map((e) => e.payload))).not.toMatch(/text|char/);
    expect(await strikeOf(id)).toBeUndefined(); // 25 + 20 is under the threshold, and no typing signal strikes alone
  });

  it('a reload of the exam page (a second camera check) is itself a soft signal', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'camera_ready' }] },
      settings.proctor,
      at(50),
    );
    expect((await events(id)).map((e) => e.type)).toContain('reference_retaken');
  });

  it('an admin confirms: the ladder applies and the attempt is annulled; a dismissed flag changes nothing', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame: jpeg('b'), reference: REF, scenario: 'phone' },
      settings.proctor,
      at(60),
    );
    await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame: jpeg('c'), reference: REF, scenario: 'second_person' },
      settings.proctor,
      at(130),
    );
    const adminUser = await makeUser(['admin']);
    await expect(listStrikeQueue(db, student)).rejects.toMatchObject({ code: 'forbidden' });
    const queue = await listStrikeQueue(db, adminUser);
    const item = queue.find((q) => q.assessmentId === id)!;
    expect(item.events.map((e) => e.type)).toEqual(['phone', 'second_person']);
    const confirmed = await reviewSoftStrike(
      db,
      adminUser,
      item.id,
      'confirm',
      { note: 'ok' },
      settings.proctor,
      at(200),
    );
    expect(confirmed).toMatchObject({ status: 'confirmed', level: 1, reviewedBy: adminUser.id });
    expect((await userRow(student.id)).examBanUntil).toEqual(at(200 + 7 * DAY));
    const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
    expect(a!.status).toBe('annulled');
    expect(
      await code(
        reviewSoftStrike(db, adminUser, item.id, 'confirm', {}, settings.proctor, at(201)),
      ),
    ).toBe('invalid_strike_state');
  });

  it('a dismissed flag leaves no ban and frees its evidence', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame: jpeg('d'), reference: REF, scenario: 'other_face' },
      settings.proctor,
      at(60),
    );
    const evidenceBefore = await db.select().from(proctorEvidence);
    expect(evidenceBefore.length).toBeGreaterThan(0);
    const adminUser = await makeUser(['admin']);
    const item = (await listStrikeQueue(db, adminUser)).find((q) => q.assessmentId === id)!;
    await reviewSoftStrike(db, adminUser, item.id, 'dismiss', {}, settings.proctor, at(100));
    expect((await strikeOf(id))?.status).toBe('dismissed');
    expect((await userRow(student.id)).examBanUntil).toBeNull();
    const own = (await events(id)).map((e) => e.id);
    expect(
      await db.select().from(proctorEvidence).where(inArray(proctorEvidence.eventId, own)),
    ).toEqual([]);
  });
});

describe('frames and evidence (F9-R4, F9-R7, D-27)', () => {
  it('a clean frame is stored nowhere and is not in llm_runs', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const before = evidenceFiles().length;
    const frame = jpeg('clean');
    const res = await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame, reference: REF, scenario: 'normal' },
      settings.proctor,
      at(60),
    );
    expect(res).toEqual({ checked: true, events: [] });
    const own = (await events(id)).map((e) => e.id);
    expect(
      await db.select().from(proctorEvidence).where(inArray(proctorEvidence.eventId, own)),
    ).toEqual([]);
    expect(evidenceFiles().length).toBe(before);
    expect((await events(id)).map((e) => e.type)).toContain('snapshot_ok');
    // The vision call is logged (every LLM call is), by the frame's hash, never with the frame itself.
    const runs = await db.select().from(llmRuns).where(eq(llmRuns.subjectId, id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ purpose: 'vision_check', model: 'mock-proctor-1' });
    expect(JSON.stringify(runs[0]!.request)).not.toContain(frame.slice(0, 20));
  });

  it('a triggering frame is kept encrypted with an expiry; the retention job deletes it and its file', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const frame = jpeg('phone');
    await checkSnapshot(
      db,
      provider,
      student,
      id,
      { frame, reference: REF, scenario: 'phone' },
      settings.proctor,
      at(60),
    );
    const own = (await events(id)).map((e) => e.id);
    const [ev] = await db
      .select()
      .from(proctorEvidence)
      .where(inArray(proctorEvidence.eventId, own));
    expect(ev!.expiresAt).toEqual(at(60 + 30 * DAY));
    const file = join(storageDir, 'evidence', ev!.storageKey);
    expect(existsSync(file)).toBe(true);
    // Encrypted at rest: neither the JPEG header nor the content shows in the file.
    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from('frame-phone'))).toBe(false);
    expect(raw[0] === 0xff && raw[1] === 0xd8).toBe(false);
    // An admin can still read it back while it lives.
    const adminUser = await makeUser(['admin']);
    expect(
      (await getEvidenceFrame(db, adminUser, ev!.id, settings.proctor)).toString('base64'),
    ).toBe(frame);

    expect(await purgeExpiredEvidence(db, storageDir, at(60 + 29 * DAY))).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(await purgeExpiredEvidence(db, storageDir, at(60 + 31 * DAY))).toBeGreaterThanOrEqual(1);
    expect(existsSync(file)).toBe(false);
    expect(await db.select().from(proctorEvidence).where(eq(proctorEvidence.id, ev!.id))).toEqual(
      [],
    );
    expect(await code(getEvidenceFrame(db, adminUser, ev!.id, settings.proctor))).toBe(
      'media_not_found',
    );
    // The event itself stays: the log is append-only.
    expect((await events(id)).some((e) => e.type === 'phone')).toBe(true);
  });

  it("frames come at the server's pace, and the scenario hint is ignored outside demo mode", async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const send = (s: number, scenario?: string, mock = true) =>
      checkSnapshot(
        db,
        new MockProctorProvider(),
        student,
        id,
        { frame: jpeg('p'), reference: REF, scenario },
        { ...settings.proctor, mock },
        at(s),
      );
    expect(await send(60)).toMatchObject({ checked: true });
    expect(await send(75)).toEqual({ checked: false, reason: 'too_soon' });
    expect(await send(95)).toMatchObject({ checked: true });
    // Real mode: the browser's scenario is not heard, so a "phone" hint gives a clean frame.
    expect(await send(200, 'phone', false)).toEqual({ checked: true, events: [] });
  });

  it('rejects something that is not a JPEG', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const junk = Buffer.from('not an image').toString('base64');
    expect(
      await code(
        checkSnapshot(
          db,
          provider,
          student,
          id,
          { frame: junk, reference: REF },
          settings.proctor,
          at(60),
        ),
      ),
    ).toBe('invalid_proctor_event');
  });

  it('a failing checker is a technical fault: logged, no strike', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    const broken = {
      name: 'broken',
      compareFace: async () => {
        throw new Error('down');
      },
      visionCheck: async () => {
        throw new Error('down');
      },
    };
    expect(
      await checkSnapshot(
        db,
        broken,
        student,
        id,
        { frame: jpeg('x'), reference: REF },
        settings.proctor,
        at(60),
      ),
    ).toEqual({ checked: false, reason: 'failed' });
    expect(await strikeOf(id)).toBeUndefined();
    expect((await events(id)).map((e) => e.type)).toContain('snapshot_failed');
  });
});

describe('appeal (F9-R6)', () => {
  it('the student appeals once; an admin overturns it and the ban is lifted, evidence freed', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'fullscreen_exit' }] },
      settings.proctor,
      at(30),
    );
    const strike = (await strikeOf(id))!;
    const [mine] = await listOwnStrikes(db, student);
    expect(mine).toMatchObject({ id: strike.id, canAppeal: true });
    const other = await makeUser(['student']);
    expect(
      await code(
        appealStrike(
          db,
          other,
          strike.id,
          { text: 'Це не я, помилка системи.' },
          settings.proctor,
          at(40),
        ),
      ),
    ).toBe('strike_not_found');
    expect(
      await code(
        appealStrike(db, student, strike.id, { text: 'коротко' }, settings.proctor, at(40)),
      ),
    ).toBe('invalid_proctor_event');
    await appealStrike(
      db,
      student,
      strike.id,
      { text: 'Екран згорнувся через системне сповіщення.' },
      settings.proctor,
      at(40),
    );
    expect((await strikeOf(id))?.status).toBe('appealed');
    // The ban stays while the appeal is open.
    expect((await userRow(student.id)).examBanUntil).toEqual(at(30 + 7 * DAY));
    const adminUser = await makeUser(['admin']);
    const item = (await listStrikeQueue(db, adminUser)).find((q) => q.assessmentId === id)!;
    expect(item.appealText).toContain('системне сповіщення');
    await resolveAppeal(
      db,
      adminUser,
      strike.id,
      'overturn',
      { note: 'ok' },
      settings.proctor,
      at(50),
    );
    expect((await strikeOf(id))?.status).toBe('overturned');
    const row = await userRow(student.id);
    expect(row.examBanUntil).toBeNull();
    expect(row.examBannedForever).toBe(false);
  });

  it('a rejected appeal keeps the ban and cannot be repeated', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await reportEvents(db, student, id, { events: [{ type: 'paste' }] }, settings.proctor, at(30));
    const strike = (await strikeOf(id))!;
    await appealStrike(
      db,
      student,
      strike.id,
      { text: 'Я нічого не вставляв, це помилка.' },
      settings.proctor,
      at(40),
    );
    const adminUser = await makeUser(['admin']);
    await resolveAppeal(db, adminUser, strike.id, 'reject', {}, settings.proctor, at(50));
    expect((await strikeOf(id))?.status).toBe('confirmed');
    expect((await userRow(student.id)).examBanUntil).toEqual(at(30 + 7 * DAY));
    expect(
      await code(
        appealStrike(
          db,
          student,
          strike.id,
          { text: 'Ще одна спроба оскаржити.' },
          settings.proctor,
          at(60),
        ),
      ),
    ).toBe('invalid_strike_state');
    expect((await listOwnStrikes(db, student))[0]!.canAppeal).toBe(false);
  });

  it('only an admin sees the queue and decides', async () => {
    const { student } = await setup();
    await expect(listStrikeQueue(db, student)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      resolveAppeal(
        db,
        student,
        '00000000-0000-4000-8000-000000000000',
        'reject',
        {},
        settings.proctor,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('a technical interruption is not a violation (F8-R6, D-20)', () => {
  it('a camera or network interruption writes no strike and no ban', async () => {
    const { student, versionId } = await setup();
    const id = await running(student, versionId);
    await interruptExam(db, student, id, 'camera', settings, at(30));
    const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
    expect(a!.status).toBe('interrupted');
    expect(await strikeOf(id)).toBeUndefined();
    const row = await userRow(student.id);
    expect(row.examBanUntil).toBeNull();
    expect(row.examBannedForever).toBe(false);
    // Events that arrive after the interruption are dropped: nothing can strike a stopped attempt.
    await reportEvents(
      db,
      student,
      id,
      { events: [{ type: 'fullscreen_exit' }] },
      settings.proctor,
      at(31),
    );
    expect(await strikeOf(id)).toBeUndefined();
    // The attempt resumes without a penalty.
    expect(await code(startExam(db, student, versionId, settings, at(60)))).toBe('ok');
  });
});
