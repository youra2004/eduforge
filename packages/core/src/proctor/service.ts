import {
  assessments,
  proctorEvents,
  proctorEvidence,
  strikes,
  users,
  type Assessment,
  type Db,
  type EventSeverity,
  type ProctorSource,
} from '@eduforge/db';
import { DrizzleLLMRunStore } from '@eduforge/llm';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { loadConfig, type Config } from '../config';
import { CourseError } from '../courses/errors';
import type { Tx } from '../courses/service';
import { logEvent } from '../learning/events';
import { MOCK_SCENARIOS, type ProctorProvider } from './provider';
import { removeEvidenceFiles, storeEvidence } from './evidence';
import {
  banForLevel,
  BROWSER_EVENTS,
  browserSeverity,
  combineBans,
  EVENT_KINDS,
  FRAME_EVIDENCE_TYPES,
  frameEvents,
  isBrowserEvent,
  keystrokeSignals,
  riskScore,
  type Ban,
  type KeystrokeSummary,
  type ServerEventType,
} from './rules';

export interface ProctorSettings {
  /** Off only in code (tests of the exam engine); never from env. */
  enabled: boolean;
  snapshotIntervalSeconds: number;
  focusGraceSeconds: number;
  riskThreshold: number;
  evidenceRetentionDays: number;
  evidenceKey: string | undefined;
  storageDir: string;
  timeScale: number;
  /** Demo mode: the browser may name the scenario the mock provider plays. */
  mock: boolean;
}

export function proctorSettings(config: Config = loadConfig()): ProctorSettings {
  return {
    enabled: true,
    snapshotIntervalSeconds: config.proctoring.snapshotIntervalSeconds,
    focusGraceSeconds: config.proctoring.focusGraceSeconds,
    riskThreshold: config.proctoring.riskThreshold,
    evidenceRetentionDays: config.proctoring.evidenceRetentionDays,
    evidenceKey: config.proctoring.evidenceKey,
    storageDir: config.storageDir,
    timeScale: config.timeScale,
    mock: config.proctoring.provider === 'mock',
  };
}

const student = (user: AuthUser | null) =>
  requireRole(user, 'student', 'author', 'expert', 'admin');

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadOwn(db: Db | Tx, user: AuthUser, examId: string) {
  const [row] = z.uuid().safeParse(examId).success
    ? await db.select().from(assessments).where(eq(assessments.id, examId))
    : [];
  if (!row || row.userId !== user.id || row.kind !== 'exam') {
    throw new CourseError('assessment_not_found');
  }
  return row;
}

interface Draft {
  source: ProctorSource;
  type: string;
  severity: EventSeverity;
  payload: Record<string, unknown>;
  /** The frame behind the event; stored encrypted as evidence (F9-R7). */
  frame?: Buffer;
}

export const draft = (
  type: ServerEventType | 'camera_ready',
  payload: Record<string, unknown> = {},
  frame?: Buffer,
) => ({
  source: EVENT_KINDS[type]!.source,
  type,
  severity: EVENT_KINDS[type]!.severity,
  payload,
  frame,
});

// ---------------------------------------------------------------- bans and strikes

/** Sets the user's exam ban from the strikes that still stand (confirmed or under appeal) (F9-R6). */
export async function recomputeBan(tx: Tx, userId: string) {
  const active = await tx
    .select()
    .from(strikes)
    .where(and(eq(strikes.userId, userId), inArray(strikes.status, ['confirmed', 'appealed'])));
  const ban = combineBans(
    active.map((s): Ban =>
      s.level >= 3 ? { forever: true, until: null } : { forever: false, until: s.banUntil },
    ),
  );
  await tx
    .update(users)
    .set({ examBannedForever: ban.forever, examBanUntil: ban.until })
    .where(eq(users.id, userId));
}

/** Confirms a strike: its place on the ladder is the number of strikes that stand, plus this one (F9-R6, D-19). */
export async function confirmInTx(
  tx: Tx,
  strike: { id: string; userId: string },
  reviewer: string | null,
  settings: ProctorSettings,
  now: Date,
) {
  // Two confirmations for one student at once must not both take the same step of the ladder.
  await tx.select({ id: users.id }).from(users).where(eq(users.id, strike.userId)).for('update');
  const [standing] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(strikes)
    .where(
      and(
        eq(strikes.userId, strike.userId),
        inArray(strikes.status, ['confirmed', 'appealed']),
        sql`${strikes.id} <> ${strike.id}`,
      ),
    );
  const level = (standing?.count ?? 0) + 1;
  const ban = banForLevel(level, now, settings.timeScale);
  const [row] = await tx
    .update(strikes)
    .set({ status: 'confirmed', level, banUntil: ban.until, reviewedBy: reviewer })
    .where(eq(strikes.id, strike.id))
    .returning();
  await recomputeBan(tx, strike.userId);
  return row!;
}

/** Closes the attempt a strike is about: a confirmed violation annuls it (the attempt counts as used). */
export async function annulAttempt(tx: Tx, a: Assessment, reason: string, now: Date) {
  const remaining = a.deadlineAt
    ? Math.max(1, Math.round((a.deadlineAt.getTime() - now.getTime()) / 1000))
    : 0;
  await tx
    .update(assessments)
    .set({
      status: 'annulled',
      submittedAt: a.submittedAt ?? now,
      meta: {
        ...(a.meta as object),
        reason: 'proctor_violation',
        violation: reason,
        remainingSeconds: remaining,
      },
    })
    .where(eq(assessments.id, a.id));
}

export async function appendEvents(
  tx: Tx,
  a: Assessment,
  drafts: Draft[],
  settings: ProctorSettings,
  now: Date,
  files: string[],
) {
  const written: { id: string; type: string; severity: EventSeverity }[] = [];
  for (const d of drafts) {
    const [row] = await tx
      .insert(proctorEvents)
      .values({
        assessmentId: a.id,
        ts: now,
        source: d.source,
        type: d.type,
        severity: d.severity,
        payload: d.frame && settings.evidenceKey ? { ...d.payload, frame: true } : d.payload,
      })
      .returning({ id: proctorEvents.id });
    if (d.frame && !settings.evidenceKey) {
      // Without a key the frame cannot be kept, but the event must not be lost with it.
      console.error(
        '[proctor] EVIDENCE_KEY is not set: the frame of a triggered event was not kept',
      );
    } else if (d.frame) {
      const stored = await storeEvidence(
        settings.storageDir,
        settings.evidenceKey,
        d.frame,
        new Date(now.getTime() + settings.evidenceRetentionDays * DAY_MS),
      );
      files.push(stored.storageKey);
      await tx.insert(proctorEvidence).values({ eventId: row!.id, ...stored });
    }
    written.push({ id: row!.id, type: d.type, severity: d.severity });
  }
  return written;
}

/**
 * Writes the events of one attempt and draws the consequences (F9-R2, F9-R3, F9-R8). A hard event stops the
 * attempt and strikes at once; soft ones add to the risk score, and past the threshold they open a strike
 * that waits for an admin. Returns false when the attempt was no longer running (events after the end are dropped).
 */
async function apply(
  db: Db,
  assessmentId: string,
  drafts: Draft[],
  settings: ProctorSettings,
  now: Date,
) {
  // Evidence files are written before the transaction commits; if it fails (the commit included), no row would point to them.
  const files: string[] = [];
  try {
    return await db.transaction((tx) =>
      applyEvents(tx, assessmentId, drafts, settings, now, files),
    );
  } catch (err) {
    await removeEvidenceFiles(settings.storageDir, files);
    throw err;
  }
}

async function applyEvents(
  tx: Tx,
  assessmentId: string,
  drafts: Draft[],
  settings: ProctorSettings,
  now: Date,
  files: string[],
) {
  const [a] = await tx
    .select()
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .for('update');
  // An exam past its deadline is over even if nobody has closed it yet: late events cannot annul it (P1).
  if (!a || a.status !== 'in_progress' || (a.deadlineAt && now >= a.deadlineAt)) return false;
  const extra: Draft[] = [];
  if (drafts.some((d) => d.type === 'camera_ready')) {
    const [seen] = await tx
      .select({ id: proctorEvents.id })
      .from(proctorEvents)
      .where(and(eq(proctorEvents.assessmentId, a.id), eq(proctorEvents.type, 'camera_ready')))
      .limit(1);
    // A second camera check inside one attempt means the page was reloaded and the reference photo is a new one.
    if (seen) extra.push(draft('reference_retaken'));
  }
  const written = await appendEvents(tx, a, [...drafts, ...extra], settings, now, files);

  const violation = written.find((e) => e.severity === 'hard');
  const [existing] = await tx
    .select({ id: strikes.id, status: strikes.status, resolvedAt: strikes.resolvedAt })
    .from(strikes)
    .where(eq(strikes.assessmentId, a.id));
  if (violation) {
    await annulAttempt(tx, a, violation.type, now);
    // One strike per attempt: a hard event after a soft flag (even a dismissed one) turns that same strike into a confirmed one.
    const [created] = existing
      ? await tx
          .update(strikes)
          .set({ reason: violation.type, status: 'pending_review', resolvedAt: null })
          .where(eq(strikes.id, existing.id))
          .returning()
      : await tx
          .insert(strikes)
          .values({
            userId: a.userId,
            assessmentId: a.id,
            reason: violation.type,
            status: 'pending_review',
            createdAt: now,
          })
          .returning();
    const strike = await confirmInTx(tx, created!, null, settings, now);
    await appendEvents(
      tx,
      a,
      [
        draft('attempt_stopped', { reason: violation.type }),
        draft('strike_created', { strikeId: strike.id, level: strike.level, auto: true }),
      ],
      settings,
      now,
      files,
    );
    await logEvent(
      tx,
      a.userId,
      'strike_created',
      { assessmentId: a.id, reason: violation.type, level: strike.level, auto: true },
      a.courseVersionId,
    );
    return true;
  }

  const all = await tx.select().from(proctorEvents).where(eq(proctorEvents.assessmentId, a.id));
  const risk = riskScore(all);
  await tx.update(assessments).set({ riskScore: risk }).where(eq(assessments.id, a.id));
  // A flag the admin dismissed counts again only for what happened after the dismissal.
  const since = existing?.status === 'dismissed' ? existing.resolvedAt : null;
  const fresh = since ? riskScore(all.filter((e) => e.ts > since)) : risk;
  if (fresh >= settings.riskThreshold && (!existing || existing.status === 'dismissed')) {
    const worst = all
      .filter((e) => e.severity === 'soft' && (!since || e.ts > since))
      .sort((x, y) => (EVENT_KINDS[y.type]?.weight ?? 0) - (EVENT_KINDS[x.type]?.weight ?? 0))[0]!;
    const [strike] = existing
      ? await tx
          .update(strikes)
          .set({ reason: `risk:${worst.type}`, status: 'pending_review', resolvedAt: null })
          .where(eq(strikes.id, existing.id))
          .returning()
      : await tx
          .insert(strikes)
          .values({
            userId: a.userId,
            assessmentId: a.id,
            reason: `risk:${worst.type}`,
            status: 'pending_review',
            createdAt: now,
          })
          .returning();
    await appendEvents(
      tx,
      a,
      [draft('strike_created', { strikeId: strike!.id, risk: fresh, auto: false })],
      settings,
      now,
      files,
    );
    await logEvent(
      tx,
      a.userId,
      'strike_created',
      { assessmentId: a.id, risk: fresh, auto: false },
      a.courseVersionId,
    );
  }
  return true;
}

// ---------------------------------------------------------------- what the browser reports

const reportSchema = z.object({
  events: z
    .array(
      z.object({ type: z.string().max(40), payload: z.record(z.string(), z.unknown()).optional() }),
    )
    .min(1)
    .max(20),
});

const keystrokeSchema = z.object({
  intervalsMs: z.array(z.number().min(0).max(60_000)).max(5000),
  corrections: z.number().int().min(0),
  chars: z.number().int().min(0),
  keys: z.number().int().min(0),
});

/**
 * Events the browser saw: leaving fullscreen, focus, copy/paste, devtools, what MediaPipe counted, the typing rhythm.
 * The browser names the type; the severity and what follows are the server's (F9-R8).
 */
export async function reportEvents(
  db: Db,
  user: AuthUser | null,
  examId: string,
  body: unknown,
  settings: ProctorSettings,
  now = new Date(),
) {
  const actor = student(user);
  const own = await loadOwn(db, actor, examId);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) throw new CourseError('invalid_proctor_event');
  const drafts: Draft[] = [];
  for (const e of parsed.data.events) {
    const payload = e.payload ?? {};
    if (e.type === 'keystroke') {
      const summary = keystrokeSchema.safeParse(payload);
      if (!summary.success) throw new CourseError('invalid_proctor_event');
      for (const signal of keystrokeSignals(summary.data as KeystrokeSummary)) {
        // Only the numbers behind the signal are kept: never the characters (D-24).
        drafts.push(
          draft(signal, {
            intervals: summary.data.intervalsMs.length,
            corrections: summary.data.corrections,
          }),
        );
      }
      continue;
    }
    if (!isBrowserEvent(e.type)) throw new CourseError('invalid_proctor_event');
    if (e.type === 'camera_ready') {
      // The reference photo is bound to the attempt by its hash only; the image itself is not kept (NFR-2).
      const reference = decodeJpeg(String(payload.reference ?? ''));
      drafts.push(
        draft('camera_ready', {
          referenceSha: createHash('sha256').update(reference).digest('hex'),
        }),
      );
      continue;
    }
    const awayMs =
      typeof payload.awayMs === 'number' ? Math.min(payload.awayMs, 3_600_000) : undefined;
    drafts.push({
      source: BROWSER_EVENTS[e.type].source,
      type: e.type,
      severity: browserSeverity(e.type, { awayMs }, settings.focusGraceSeconds * 1000),
      payload: awayMs === undefined ? {} : { awayMs },
    });
  }
  const accepted = drafts.length === 0 ? true : await apply(db, own.id, drafts, settings, now);
  return { accepted };
}

// ---------------------------------------------------------------- the snapshot (F9-R4)

const MAX_FRAME_BYTES = 1_500_000;

const frameSchema = z.object({
  frame: z.string().min(1),
  reference: z.string().min(1),
  scenario: z.string().max(20).optional(),
});

function decodeJpeg(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  // JPEG starts with FF D8 FF; this keeps arbitrary payloads out of the pipeline and the evidence store.
  if (buf.length < 4 || buf.length > MAX_FRAME_BYTES || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new CourseError('invalid_proctor_event');
  }
  return buf;
}

/**
 * Checks one frame: face against the reference photo, then a Vision look for a phone, a second person, gaze away.
 * The frame lives in memory for this call. It is kept (encrypted, with a lifetime) only when it triggered an
 * event; a clean frame is stored nowhere (F9-R4, F9-R7, D-27).
 */
export async function checkSnapshot(
  db: Db,
  provider: ProctorProvider,
  user: AuthUser | null,
  examId: string,
  body: unknown,
  settings: ProctorSettings,
  now = new Date(),
) {
  const actor = student(user);
  const own = await loadOwn(db, actor, examId);
  const parsed = frameSchema.safeParse(body);
  if (!parsed.success) throw new CourseError('invalid_proctor_event');
  const frame = decodeJpeg(parsed.data.frame);
  const reference = decodeJpeg(parsed.data.reference);
  // Under the attempt's lock: still running, at the server's pace, and the reference is the one given at the gate.
  // The slot is taken (an info event) before the slow check, so parallel requests cannot all pass (cost, flooding).
  const gate = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(assessments).where(eq(assessments.id, own.id)).for('update');
    if (!a || a.status !== 'in_progress' || (a.deadlineAt && now >= a.deadlineAt)) {
      return { reason: 'closed' as const };
    }
    const [last] = await tx
      .select({ ts: proctorEvents.ts })
      .from(proctorEvents)
      .where(and(eq(proctorEvents.assessmentId, own.id), eq(proctorEvents.source, 'frame')))
      .orderBy(desc(proctorEvents.ts))
      .limit(1);
    if (last && now.getTime() - last.ts.getTime() < (settings.snapshotIntervalSeconds * 1000) / 2) {
      return { reason: 'too_soon' as const };
    }
    const [ready] = await tx
      .select({ payload: proctorEvents.payload })
      .from(proctorEvents)
      .where(and(eq(proctorEvents.assessmentId, own.id), eq(proctorEvents.type, 'camera_ready')))
      .orderBy(desc(proctorEvents.ts))
      .limit(1);
    const wanted = (ready?.payload as { referenceSha?: string } | undefined)?.referenceSha;
    await appendEvents(tx, a, [draft('snapshot_started')], settings, now, []);
    return {
      referenceOk: !!wanted && wanted === createHash('sha256').update(reference).digest('hex'),
    };
  });
  if ('reason' in gate) return { checked: false as const, reason: gate.reason };
  if (!gate.referenceOk) {
    // A reference that is not the one from the gate: the face check would prove nothing, so it is flagged instead.
    await apply(db, own.id, [draft('reference_changed')], settings, now);
    return { checked: false as const, reason: 'reference_changed' as const };
  }

  // Only demo mode listens to the browser's scenario; a real provider never sees it.
  const hint =
    settings.mock && MOCK_SCENARIOS.includes(parsed.data.scenario as never)
      ? parsed.data.scenario
      : undefined;
  let checks;
  try {
    const [face, vision] = await Promise.all([
      provider.compareFace(reference, frame, hint),
      provider.visionCheck(frame, hint),
    ]);
    checks = { face, vision };
    // A Vision call is an LLM call: it is logged like every other, with the frame's hash and not the frame (P3, NFR-2).
    await new DrizzleLLMRunStore(db).insert({
      purpose: 'vision_check',
      model: provider.name,
      promptVersion: 'vision-v1',
      promptHash: createHash('sha256').update(frame).digest('hex'),
      request: { frameBytes: frame.length },
      response: vision,
      subjectType: 'assessment',
      subjectId: own.id,
    });
  } catch (err) {
    // A failing service is a technical fault, not a violation (D-20).
    console.error('[proctor] frame check failed', err);
    await apply(db, own.id, [draft('snapshot_failed')], settings, now);
    return { checked: false as const, reason: 'failed' as const };
  }

  const types = frameEvents({
    match: checks.face.match,
    phone: checks.vision.phone,
    secondPerson: checks.vision.secondPerson,
    gazeAway: checks.vision.gazeAway,
  });
  const drafts = types.length
    ? types.map((t) =>
        draft(
          t,
          { score: checks.face.score },
          FRAME_EVIDENCE_TYPES.includes(t) ? frame : undefined,
        ),
      )
    : [draft('snapshot_ok', { score: checks.face.score })];
  await apply(db, own.id, drafts, settings, now);
  return { checked: true as const, events: types };
}

// ---------------------------------------------------------------- the camera gate

/** True once the camera and the reference photo were reported for this attempt (F9-R1, D-27). */
export async function isCameraReady(db: Db | Tx, assessmentId: string) {
  const [row] = await db
    .select({ id: proctorEvents.id })
    .from(proctorEvents)
    .where(
      and(eq(proctorEvents.assessmentId, assessmentId), eq(proctorEvents.type, 'camera_ready')),
    )
    .limit(1);
  return !!row;
}

export async function proctorTimeline(db: Db | Tx, assessmentId: string) {
  const events = await db
    .select()
    .from(proctorEvents)
    .where(eq(proctorEvents.assessmentId, assessmentId))
    .orderBy(asc(proctorEvents.ts));
  return events;
}
