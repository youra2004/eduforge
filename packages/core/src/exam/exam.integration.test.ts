import { readFileSync } from 'node:fs';
import {
  assessmentItems,
  assessments,
  courseVersions,
  createDb,
  enrollments,
  eventLog,
  nodeProgress,
  questions,
  users,
} from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient } from '@eduforge/llm';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/guard';
import { loadConfig } from '../config';
import { CourseError } from '../courses/errors';
import { getVersionGraph, importCourse } from '../courses/service';
import { enroll, getAssessment, learningSettings } from '../learning/service';
import { createQuestionMock } from '../questions/mock';
import {
  answerExam,
  examSettings,
  getExam,
  getExamStatus,
  interruptExam,
  saveExamDraft,
  startExam,
  type ExamView,
} from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);
const llm = new LLMClient(createQuestionMock(), new DrizzleLLMRunStore(db));
const settings = examSettings(loadConfig({ DATABASE_URL: 'x' }));
const T0 = new Date('2026-03-01T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const DAY = 24 * 60 * 60;
const CORRECT = 1;
const WRONG = 0;
const POOL_PER_SKILL = 4; // 11 skills, so 44 questions: enough for the biggest profile (40)

let n = 0;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `exam-test-${Date.now()}-${n++}@test.local`;
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

/** A published, rated copy of the demo course whose student has passed every node. */
async function setup(opts: { rating?: number; passNodes?: boolean } = {}) {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(demo), slug: `exam-${Date.now()}-${n++}` },
    author.id,
  );
  await db
    .update(courseVersions)
    .set({ status: 'published', rating: opts.rating ?? 2 })
    .where(eq(courseVersions.id, versionId));
  const graph = await getVersionGraph(db, author, versionId);
  for (const node of graph.nodes) {
    for (const skillId of node.skillIds) {
      for (const [poolName, count] of [
        ['exam', POOL_PER_SKILL],
        ['node', 4],
      ] as const) {
        await db.insert(questions).values(
          Array.from({ length: count }, (_, i) => ({
            nodeId: node.id,
            skillId,
            pool: poolName,
            kind: 'mcq' as const,
            promptMd: `Питання ${poolName} ${i}`,
            options: ['Невірно', 'Вірно', 'Теж невірно', 'І це невірно'],
            answerKey: { optionIndex: CORRECT },
            guess: 0.25,
            status: 'validated' as const,
          })),
        );
      }
    }
  }
  const student = await makeUser(['student']);
  await enroll(db, student, versionId);
  if (opts.passNodes !== false) await passAllNodes(student, versionId);
  return { author, student, versionId, graph };
}

async function passAllNodes(student: AuthUser, versionId: string) {
  const ids = (await getVersionGraph(db, student, versionId)).nodes.map((x) => x.id);
  await db
    .update(nodeProgress)
    .set({ state: 'passed', passedAt: T0 })
    .where(and(eq(nodeProgress.userId, student.id), inArray(nodeProgress.nodeId, ids)));
  await db
    .update(enrollments)
    .set({ status: 'completed', completedAt: T0 })
    .where(and(eq(enrollments.userId, student.id), eq(enrollments.courseVersionId, versionId)));
}

/** Answers the running exam question by question: the first `right` right, the rest wrong. Returns the last view. */
async function takeExam(
  student: AuthUser,
  start: ExamView,
  opts: { right: number; now?: Date },
): Promise<ExamView> {
  let view = start;
  let given = 0;
  while (view.current) {
    view = await answerExam(
      db,
      llm,
      student,
      view.id,
      view.current.itemId,
      { optionIndex: given++ < opts.right ? CORRECT : WRONG },
      settings,
      opts.now ?? T0,
    );
  }
  return view;
}

const itemsOf = (examId: string) =>
  db
    .select()
    .from(assessmentItems)
    .where(eq(assessmentItems.assessmentId, examId))
    .orderBy(assessmentItems.ord);

describe('eligibility (F8-R1)', () => {
  it('needs every node passed, an enrollment and no ban; the server says why', async () => {
    const stranger = await makeUser(['student']);
    const { student, versionId } = await setup({ passNodes: false });
    expect(await code(startExam(db, stranger, versionId, settings, T0))).toBe('not_enrolled');
    expect(await code(startExam(db, student, versionId, settings, T0))).toBe('exam_not_eligible');
    const status = await getExamStatus(db, student, versionId, settings, T0);
    expect(status).toMatchObject({ canStart: false, blockedBy: 'exam_not_eligible' });
    expect(status.nodes.passed).toBe(0);

    await passAllNodes(student, versionId);
    expect(await code(startExam(db, student, versionId, settings, T0))).toBe('ok');
  });

  it('checks the ban fields: a ban until a date ends by itself, a permanent one does not', async () => {
    const { student, versionId } = await setup();
    await db
      .update(users)
      .set({ examBanUntil: at(7 * DAY) })
      .where(eq(users.id, student.id));
    expect(await code(startExam(db, student, versionId, settings, at(DAY)))).toBe('exam_banned');
    expect((await getExamStatus(db, student, versionId, settings, at(DAY))).ban).toMatchObject({
      forever: false,
    });
    expect(await code(startExam(db, student, versionId, settings, at(7 * DAY)))).toBe('ok');

    const other = await setup();
    await db.update(users).set({ examBannedForever: true }).where(eq(users.id, other.student.id));
    expect(await code(startExam(db, other.student, other.versionId, settings, at(900 * DAY)))).toBe(
      'exam_banned',
    );
  });

  it('refuses when a skill has no exam question', async () => {
    const { student, versionId, graph } = await setup();
    await db
      .delete(questions)
      .where(and(eq(questions.skillId, graph.skills[0]!.id), eq(questions.pool, 'exam')));
    expect(await code(startExam(db, student, versionId, settings, T0))).toBe('test_unavailable');
  });
});

describe('the question set (F8-R2)', () => {
  it.each([
    [2, 20, 45 * 60],
    [5, 30, 60 * 60],
    [9, 40, 90 * 60],
  ])('rating %i: %i questions in %i s, only from the exam pool', async (rating, count, seconds) => {
    const { student, versionId } = await setup({ rating });
    const view = await startExam(db, student, versionId, settings, T0);
    expect(view.total).toBe(count);
    expect(view.deadlineAt).toEqual(at(seconds));
    const rows = await itemsOf(view.id);
    const pools = await db
      .select({ pool: questions.pool })
      .from(questions)
      .where(
        inArray(
          questions.id,
          rows.map((r) => r.questionId),
        ),
      );
    expect(pools.every((p) => p.pool === 'exam')).toBe(true);
    // 11 skills share the questions evenly: every skill gets count/11 rounded down or up
    const skills = await db
      .select({ skillId: questions.skillId })
      .from(questions)
      .where(
        inArray(
          questions.id,
          rows.map((r) => r.questionId),
        ),
      );
    const perSkill = new Map<string, number>();
    for (const s of skills) perSkill.set(s.skillId, (perSkill.get(s.skillId) ?? 0) + 1);
    expect(perSkill.size).toBe(11);
    expect(Math.max(...perSkill.values()) - Math.min(...perSkill.values())).toBeLessThanOrEqual(1);
  });

  it('uses the per-question limits from config', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    expect(view.current!.deadlineAt).toEqual(at(90));
  });

  it('shows one question at a time and never a key, a verdict or another question', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    const json = JSON.stringify(view);
    expect(view.current).toMatchObject({ position: 1 });
    expect(Object.keys(view.current!.question).sort()).toEqual([
      'id',
      'kind',
      'options',
      'promptMd',
    ]);
    expect(json).not.toMatch(/answerKey|rubric|isCorrect|guess|slip/);
    // the exam has no list of all its questions to read ahead or go back to
    expect(json.match(/promptMd/g)).toHaveLength(1);

    const next = await answerExam(
      db,
      llm,
      student,
      view.id,
      view.current!.itemId,
      { optionIndex: CORRECT },
      settings,
      at(5),
    );
    expect(next.current!.position).toBe(2);
    expect(JSON.stringify(next)).not.toMatch(/isCorrect/);
  });

  it('keeps an exam question out of the generic assessment view and away from other users', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    expect(await code(getAssessment(db, student, view.id, learningSettings()))).toBe(
      'assessment_not_found',
    );
    const other = await makeUser(['student']);
    expect(await code(getExam(db, other, view.id, settings, T0))).toBe('assessment_not_found');
  });

  it('returns the running exam instead of starting a second one, also for parallel clicks', async () => {
    const { student, versionId } = await setup();
    const views = await Promise.all(
      [1, 2, 3].map((seed) => startExam(db, student, versionId, settings, T0, seed)),
    );
    expect(new Set(views.map((v) => v.id)).size).toBe(1);
    const rows = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.userId, student.id), eq(assessments.kind, 'exam')));
    expect(rows).toHaveLength(1);
  });
});

describe('server-side timers (F8-R3, P1)', () => {
  it('rejects an answer after the question deadline and moves on with no points', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    const first = view.current!.itemId;
    expect(
      await code(
        answerExam(db, llm, student, view.id, first, { optionIndex: CORRECT }, settings, at(91)),
      ),
    ).toBe('exam_time_expired');
    const [row] = await itemsOf(view.id);
    expect(row).toMatchObject({ score: 0, isCorrect: false });
    // The page that opens later shows the next question, which started when the first one ended
    const again = await getExam(db, student, view.id, settings, at(100));
    expect(again.current).toMatchObject({ position: 2, deadlineAt: at(180) });
    // and asking again does not make the time come back
    expect(
      await code(
        answerExam(db, llm, student, view.id, first, { optionIndex: CORRECT }, settings, at(100)),
      ),
    ).toBe('exam_time_expired');
  });

  it('accepts an answer at the exact deadline', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    const next = await answerExam(
      db,
      llm,
      student,
      view.id,
      view.current!.itemId,
      { optionIndex: CORRECT },
      settings,
      at(90),
    );
    expect(next.current!.position).toBe(2);
    const [row] = await itemsOf(view.id);
    expect(row).toMatchObject({ score: 1, isCorrect: true });
  });

  it('rejects any answer after the exam deadline and grades the exam as it stood', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    let view = await startExam(db, student, versionId, settings, T0);
    for (let i = 0; i < 5; i++) {
      view = await answerExam(
        db,
        llm,
        student,
        view.id,
        view.current!.itemId,
        { optionIndex: CORRECT },
        settings,
        at(10 + i),
      );
    }
    const late = at(45 * 60 + 1);
    expect(
      await code(
        answerExam(
          db,
          llm,
          student,
          view.id,
          view.current!.itemId,
          { optionIndex: CORRECT },
          settings,
          late,
        ),
      ),
    ).toBe('exam_time_expired');
    const done = await getExam(db, student, view.id, settings, late);
    expect(done.status).toBe('failed');
    expect(done.result!.scorePct).toBeCloseTo((5 / 20) * 100, 9);
    expect(done.current).toBeNull();
    // 15 questions were never answered and count as nothing
    const rows = await itemsOf(view.id);
    expect(rows.every((r) => r.answeredAt !== null)).toBe(true);
    expect(rows.filter((r) => r.score === 1)).toHaveLength(5);
  });

  it('closes an abandoned exam when its deadline has passed, with no client call', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    const status = await getExamStatus(db, student, versionId, settings, at(46 * 60));
    expect(status.runningId).toBeNull();
    expect(status.history).toMatchObject([{ id: view.id, status: 'failed' }]);
    expect(status.attemptsLeft).toBe(1);
  });

  it('keeps the autosaved draft for a reload but does not score it when time runs out', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    await saveExamDraft(
      db,
      student,
      view.id,
      view.current!.itemId,
      { optionIndex: CORRECT },
      settings,
      at(30),
    );
    const reloaded = await getExam(db, student, view.id, settings, at(40));
    expect(reloaded.current!.draft).toEqual({ optionIndex: CORRECT });
    const later = await getExam(db, student, view.id, settings, at(95));
    expect(later.current!.position).toBe(2);
    const [row] = await itemsOf(view.id);
    expect(row).toMatchObject({ score: 0, isCorrect: false });
    expect(
      await code(
        saveExamDraft(
          db,
          student,
          view.id,
          view.current!.itemId,
          { optionIndex: CORRECT },
          settings,
          at(96),
        ),
      ),
    ).toBe('exam_time_expired');
  });

  it('refuses answers to a question that is not the current one', async () => {
    const { student, versionId } = await setup();
    const view = await startExam(db, student, versionId, settings, T0);
    const rows = await itemsOf(view.id);
    const future = rows[3]!;
    expect(
      await code(
        answerExam(db, llm, student, view.id, future.id, { optionIndex: CORRECT }, settings, at(5)),
      ),
    ).toBe('exam_not_current');
    const done = rows[0]!;
    await answerExam(db, llm, student, view.id, done.id, { optionIndex: CORRECT }, settings, at(5));
    expect(
      await code(
        answerExam(db, llm, student, view.id, done.id, { optionIndex: WRONG }, settings, at(6)),
      ),
    ).toBe('already_answered');
  });
});

describe('result (F8-R4, F8-R7)', () => {
  it('passes at exactly 70 % and fails one answer below, with the per-skill breakdown', async () => {
    const pass = await setup({ rating: 2 });
    const passView = await takeExam(
      pass.student,
      await startExam(db, pass.student, pass.versionId, settings, T0),
      { right: 14 },
    );
    expect(passView).toMatchObject({ status: 'passed' });
    expect(passView.result).toMatchObject({ passed: true, scorePct: 70, passPct: 70 });

    const fail = await setup({ rating: 2 });
    const failView = await takeExam(
      fail.student,
      await startExam(db, fail.student, fail.versionId, settings, T0),
      { right: 13 },
    );
    expect(failView).toMatchObject({ status: 'failed' });
    expect(failView.result).toMatchObject({ passed: false, scorePct: 65 });
  });

  it('computes each skill from its own questions and names its level', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    const done = await takeExam(student, await startExam(db, student, versionId, settings, T0), {
      right: 14,
    });
    const rows = await db
      .select({ score: assessmentItems.score, skillId: questions.skillId })
      .from(assessmentItems)
      .innerJoin(questions, eq(questions.id, assessmentItems.questionId))
      .where(eq(assessmentItems.assessmentId, done.id));
    const perSkill = done.result!.perSkill;
    expect(perSkill).toHaveLength(11);
    for (const s of perSkill) {
      const own = rows.filter((r) => r.skillId === s.skillId);
      const pct = (own.reduce((sum, r) => sum + (r.score ?? 0), 0) * 100) / own.length;
      expect(s.pct).toBeCloseTo(pct, 9);
      expect(s.level).toBe(pct >= 90 ? 'perfect' : pct >= 70 ? 'good' : 'needs_work');
    }
    expect(perSkill.some((s) => s.level === 'perfect')).toBe(true);
    expect(perSkill.some((s) => s.level === 'needs_work')).toBe(true);
    // the grades are stored for the certificate (M11)
    const [stored] = await db.select().from(assessments).where(eq(assessments.id, done.id));
    expect(stored!.perSkill).toEqual(perSkill);
  });

  it('writes research events for start, answers and submission (P5)', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    await takeExam(student, await startExam(db, student, versionId, settings, T0), { right: 20 });
    const events = await db.select().from(eventLog).where(eq(eventLog.userId, student.id));
    const names = events.map((e) => e.name);
    expect(names).toContain('exam_started');
    expect(names.filter((x) => x === 'question_answered')).toHaveLength(20);
    expect(names).toContain('exam_submitted');
  });
});

describe('attempt rounds (F8-R5)', () => {
  it('pauses for seven days after two failed attempts, then starts a new round', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    const first = await takeExam(student, await startExam(db, student, versionId, settings, T0), {
      right: 0,
    });
    expect(first.result).toMatchObject({ attemptsLeft: 1, cooldownUntil: null });
    const second = await takeExam(
      student,
      await startExam(db, student, versionId, settings, at(100)),
      { right: 0, now: at(100) },
    );
    expect(second).toMatchObject({ roundNo: 1, attemptNo: 2 });
    expect(second.result).toMatchObject({ attemptsLeft: 0, cooldownUntil: at(100 + 7 * DAY) });

    expect(await code(startExam(db, student, versionId, settings, at(100 + 7 * DAY - 1)))).toBe(
      'exam_cooldown',
    );
    expect(await getExamStatus(db, student, versionId, settings, at(DAY))).toMatchObject({
      canStart: false,
      blockedBy: 'exam_cooldown',
    });

    const next = await startExam(db, student, versionId, settings, at(100 + 7 * DAY));
    expect(next).toMatchObject({ roundNo: 2, attemptNo: 1 });
  });

  it('follows TIME_SCALE: a week lasts seven minutes at 1440', async () => {
    const scaled = examSettings(loadConfig({ DATABASE_URL: 'x', TIME_SCALE: '1440' }));
    expect(scaled.cooldownSeconds).toBe(7 * 60);
  });

  it('is finished after a pass: no second exam', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    await takeExam(student, await startExam(db, student, versionId, settings, T0), { right: 20 });
    expect(await code(startExam(db, student, versionId, settings, at(10 * DAY)))).toBe(
      'exam_passed',
    );
  });
});

describe('interruptions (F8-R6)', () => {
  it('stops the attempt without using it, and resumes with a new set and the time that was left', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    const view = await startExam(db, student, versionId, settings, T0, 1);
    await answerExam(
      db,
      llm,
      student,
      view.id,
      view.current!.itemId,
      { optionIndex: CORRECT },
      settings,
      at(10),
    );
    const stopped = await interruptExam(db, student, view.id, 'network', settings, at(600));
    expect(stopped).toMatchObject({ status: 'interrupted', interruptions: 1, canResume: true });
    expect(stopped.current).toBeNull();
    // no answers while it is stopped
    expect(
      await code(
        answerExam(
          db,
          llm,
          student,
          view.id,
          view.current!.itemId,
          { optionIndex: 1 },
          settings,
          at(601),
        ),
      ),
    ).toBe('assessment_closed');
    const status = await getExamStatus(db, student, versionId, settings, at(700));
    expect(status).toMatchObject({ attemptNo: 1, attemptsLeft: 2, interrupted: { id: view.id } });

    const resumed = await startExam(db, student, versionId, settings, at(1000), 2);
    expect(resumed.id).not.toBe(view.id);
    expect(resumed).toMatchObject({ attemptNo: 1, interruptions: 1, answered: 0 });
    // 45 min − 10 min used = 35 min left, counted from the moment of resumption
    expect(resumed.deadlineAt).toEqual(at(1000 + 45 * 60 - 600));
    const before = (await itemsOf(view.id)).map((r) => r.questionId);
    const after = (await itemsOf(resumed.id)).map((r) => r.questionId);
    expect(after).not.toEqual(before);
    expect(after).toHaveLength(20);
  });

  it('counts the attempt as used when the limit is exceeded, with no strike and no ban', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    let view = await startExam(db, student, versionId, settings, T0, 1);
    for (let i = 1; i <= 2; i++) {
      view = await interruptExam(db, student, view.id, 'camera', settings, at(i * 100));
      expect(view.status).toBe('interrupted');
      view = await startExam(db, student, versionId, settings, at(i * 100 + 10), i + 1);
    }
    view = await interruptExam(db, student, view.id, 'network', settings, at(400));
    expect(view).toMatchObject({ status: 'failed', interruptions: 3 });
    expect(view.result).toMatchObject({ reason: 'interruptions_exceeded', attemptsLeft: 1 });
    expect(view.canResume).toBe(false);

    const status = await getExamStatus(db, student, versionId, settings, at(500));
    expect(status).toMatchObject({ attemptNo: 2, attemptsLeft: 1, interrupted: null });
    const [u] = await db.select().from(users).where(eq(users.id, student.id));
    expect(u).toMatchObject({ examBanUntil: null, examBannedForever: false });
    // the new attempt starts with a clean count
    const next = await startExam(db, student, versionId, settings, at(500));
    expect(next).toMatchObject({ attemptNo: 2, interruptions: 0 });
  });

  it('fails the attempt even when the answered part would have passed', async () => {
    const { student, versionId } = await setup({ rating: 2 });
    let view = await startExam(db, student, versionId, settings, T0, 1);
    await interruptExam(db, student, view.id, 'other', settings, at(10));
    view = await startExam(db, student, versionId, settings, at(20), 2);
    await interruptExam(db, student, view.id, 'other', settings, at(30));
    view = await startExam(db, student, versionId, settings, at(40), 3);
    for (let i = 0; i < 19; i++) {
      view = await answerExam(
        db,
        llm,
        student,
        view.id,
        view.current!.itemId,
        { optionIndex: CORRECT },
        settings,
        at(50 + i),
      );
    }
    view = await interruptExam(db, student, view.id, 'network', settings, at(100));
    expect(view.status).toBe('failed');
    expect(view.result!.scorePct).toBe(95);
    expect(view.result!.passed).toBe(false);
  });
});
