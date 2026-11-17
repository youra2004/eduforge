import {
  assessments,
  courseVersions,
  proctorEvents,
  proctorEvidence,
  strikes,
  users,
  type Assessment,
  type Db,
  type Strike,
} from '@eduforge/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import type { Tx } from '../courses/service';
import { logEvent } from '../learning/events';
import { purgeEvidenceOfEvents, readEvidence } from './evidence';
import {
  annulAttempt,
  appendEvents,
  confirmInTx,
  draft,
  recomputeBan,
  type ProctorSettings,
} from './service';

const student = (user: AuthUser | null) =>
  requireRole(user, 'student', 'author', 'expert', 'admin');
const admin = (user: AuthUser | null) => requireRole(user, 'admin');

const STRIKE_COLUMNS = {
  id: strikes.id,
  userId: strikes.userId,
  assessmentId: strikes.assessmentId,
  reason: strikes.reason,
  status: strikes.status,
  level: strikes.level,
  banUntil: strikes.banUntil,
  resolvedAt: strikes.resolvedAt,
  createdAt: strikes.createdAt,
};

/** The student's own strikes, with what they may do about each (F9-R6: an appeal exists). */
export async function listOwnStrikes(db: Db, user: AuthUser | null) {
  const actor = student(user);
  const rows = await db
    .select({ ...STRIKE_COLUMNS, courseTitle: courseVersions.title })
    .from(strikes)
    .innerJoin(assessments, eq(assessments.id, strikes.assessmentId))
    .innerJoin(courseVersions, eq(courseVersions.id, assessments.courseVersionId))
    .where(eq(strikes.userId, actor.id))
    .orderBy(desc(strikes.createdAt));
  return (
    rows
      // A strike nobody confirmed is not shown to the student: it is only a flag for the admin.
      .filter((r) => r.status !== 'pending_review')
      .map((r) => ({ ...r, canAppeal: r.status === 'confirmed' && r.resolvedAt === null }))
  );
}

async function loadStrike(tx: Tx | Db, strikeId: string) {
  const [row] = z.uuid().safeParse(strikeId).success
    ? await tx.select().from(strikes).where(eq(strikes.id, strikeId)).for('update')
    : [];
  if (!row) throw new CourseError('strike_not_found');
  return row;
}

async function loadAssessment(tx: Tx, assessmentId: string) {
  const [a] = await tx
    .select()
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .for('update');
  return a!;
}

const appealSchema = z.object({ text: z.string().trim().min(10).max(2000) });

/** A student appeals a confirmed strike once; an admin decides (F9-R6). The ban stays while the appeal is open. */
export async function appealStrike(
  db: Db,
  user: AuthUser | null,
  strikeId: string,
  body: unknown,
  settings: ProctorSettings,
  now = new Date(),
) {
  const actor = student(user);
  const parsed = appealSchema.safeParse(body);
  if (!parsed.success) throw new CourseError('invalid_proctor_event');
  return db.transaction(async (tx) => {
    const strike = await loadStrike(tx, strikeId);
    if (strike.userId !== actor.id) throw new CourseError('strike_not_found');
    if (strike.status !== 'confirmed' || strike.resolvedAt)
      throw new CourseError('invalid_strike_state');
    const a = await loadAssessment(tx, strike.assessmentId);
    const [updated] = await tx
      .update(strikes)
      .set({ status: 'appealed' })
      .where(eq(strikes.id, strike.id))
      .returning();
    // The appeal text is part of the attempt's append-only log.
    await appendEvents(
      tx,
      a,
      [draft('appeal', { strikeId: strike.id, text: parsed.data.text })],
      settings,
      now,
      [],
    );
    await logEvent(tx, actor.id, 'strike_appealed', { strikeId: strike.id }, a.courseVersionId);
    return updated!;
  });
}

// ---------------------------------------------------------------- the admin's side

/** Strikes waiting for the admin: unconfirmed soft ones and open appeals, each with its attempt's log (F9-R3, F9-R6). */
export async function listStrikeQueue(db: Db, user: AuthUser | null) {
  admin(user);
  const rows = await db
    .select({
      ...STRIKE_COLUMNS,
      displayName: users.displayName,
      email: users.email,
      courseTitle: courseVersions.title,
      riskScore: assessments.riskScore,
    })
    .from(strikes)
    .innerJoin(users, eq(users.id, strikes.userId))
    .innerJoin(assessments, eq(assessments.id, strikes.assessmentId))
    .innerJoin(courseVersions, eq(courseVersions.id, assessments.courseVersionId))
    .where(inArray(strikes.status, ['pending_review', 'appealed']))
    .orderBy(asc(strikes.createdAt));
  if (rows.length === 0) return [];
  const events = await db
    .select({
      id: proctorEvents.id,
      assessmentId: proctorEvents.assessmentId,
      ts: proctorEvents.ts,
      source: proctorEvents.source,
      type: proctorEvents.type,
      severity: proctorEvents.severity,
      payload: proctorEvents.payload,
      evidenceId: proctorEvidence.id,
    })
    .from(proctorEvents)
    .leftJoin(proctorEvidence, eq(proctorEvidence.eventId, proctorEvents.id))
    .where(
      and(
        inArray(
          proctorEvents.assessmentId,
          rows.map((r) => r.assessmentId),
        ),
        inArray(proctorEvents.severity, ['soft', 'hard']),
      ),
    )
    .orderBy(asc(proctorEvents.ts));
  const appeals = await db
    .select({ assessmentId: proctorEvents.assessmentId, payload: proctorEvents.payload })
    .from(proctorEvents)
    .where(
      and(
        inArray(
          proctorEvents.assessmentId,
          rows.map((r) => r.assessmentId),
        ),
        eq(proctorEvents.type, 'appeal'),
      ),
    );
  return rows.map((r) => ({
    ...r,
    events: events.filter((e) => e.assessmentId === r.assessmentId),
    appealText:
      r.status === 'appealed'
        ? ((appeals.find((x) => x.assessmentId === r.assessmentId)?.payload as { text?: string })
            ?.text ?? null)
        : null,
  }));
}

/** The decrypted frame of an event, for the admin looking at a case. Evidence that expired is gone (F9-R7). */
export async function getEvidenceFrame(
  db: Db,
  user: AuthUser | null,
  evidenceId: string,
  settings: ProctorSettings,
) {
  admin(user);
  const [row] = z.uuid().safeParse(evidenceId).success
    ? await db.select().from(proctorEvidence).where(eq(proctorEvidence.id, evidenceId))
    : [];
  if (!row) throw new CourseError('media_not_found');
  return readEvidence(settings.storageDir, settings.evidenceKey, row.storageKey);
}

async function eventIdsOf(tx: Tx, assessmentId: string) {
  const rows = await tx
    .select({ id: proctorEvents.id })
    .from(proctorEvents)
    .where(eq(proctorEvents.assessmentId, assessmentId));
  return rows.map((r) => r.id);
}

const decision = z.object({ note: z.string().trim().max(2000).optional() });

async function recordDecision(
  tx: Tx,
  a: Assessment,
  strike: Strike,
  outcome: string,
  reviewer: string,
  note: string | undefined,
  settings: ProctorSettings,
  now: Date,
) {
  await appendEvents(
    tx,
    a,
    [
      draft('strike_decision', {
        strikeId: strike.id,
        outcome,
        reviewer,
        ...(note ? { note } : {}),
      }),
    ],
    settings,
    now,
    [],
  );
  await logEvent(
    tx,
    a.userId,
    'strike_decided',
    { strikeId: strike.id, outcome },
    a.courseVersionId,
  );
}

/** Admin: a soft flag is a real strike (the ladder applies), or it is not (F9-R3). Closing the case frees its evidence. */
export async function reviewSoftStrike(
  db: Db,
  user: AuthUser | null,
  strikeId: string,
  outcome: 'confirm' | 'dismiss',
  body: unknown,
  settings: ProctorSettings,
  now = new Date(),
) {
  const reviewer = admin(user);
  const note = decision.parse(body ?? {}).note;
  const result = await db.transaction(async (tx) => {
    const strike = await loadStrike(tx, strikeId);
    if (strike.status !== 'pending_review') throw new CourseError('invalid_strike_state');
    const a = await loadAssessment(tx, strike.assessmentId);
    let updated: Strike;
    if (outcome === 'confirm') {
      updated = await confirmInTx(tx, strike, reviewer.id, settings, now);
      // A confirmed violation annuls the attempt, even one that already finished with a pass.
      await annulAttempt(tx, a, strike.reason, now);
    } else {
      [updated] = (await tx
        .update(strikes)
        .set({ status: 'dismissed', reviewedBy: reviewer.id, resolvedAt: now })
        .where(eq(strikes.id, strike.id))
        .returning()) as [Strike];
    }
    await recordDecision(tx, a, updated, outcome, reviewer.id, note, settings, now);
    return { strike: updated, eventIds: outcome === 'dismiss' ? await eventIdsOf(tx, a.id) : [] };
  });
  if (result.eventIds.length) await purgeEvidenceOfEvents(db, settings.storageDir, result.eventIds);
  return result.strike;
}

/** Admin: decides an appeal. Overturned lifts the ban; rejected keeps it and closes the case (F9-R6, F9-R7). */
export async function resolveAppeal(
  db: Db,
  user: AuthUser | null,
  strikeId: string,
  outcome: 'overturn' | 'reject',
  body: unknown,
  settings: ProctorSettings,
  now = new Date(),
) {
  const reviewer = admin(user);
  const note = decision.parse(body ?? {}).note;
  const result = await db.transaction(async (tx) => {
    const strike = await loadStrike(tx, strikeId);
    if (strike.status !== 'appealed') throw new CourseError('invalid_strike_state');
    const a = await loadAssessment(tx, strike.assessmentId);
    const [updated] = await tx
      .update(strikes)
      .set({
        status: outcome === 'overturn' ? 'overturned' : 'confirmed',
        reviewedBy: reviewer.id,
        resolvedAt: now,
      })
      .where(eq(strikes.id, strike.id))
      .returning();
    await recomputeBan(tx, strike.userId);
    await recordDecision(tx, a, updated!, outcome, reviewer.id, note, settings, now);
    return { strike: updated!, eventIds: await eventIdsOf(tx, a.id) };
  });
  // The case is closed either way, so the frames are no longer needed.
  await purgeEvidenceOfEvents(db, settings.storageDir, result.eventIds);
  return result.strike;
}
