import { randomInt } from 'node:crypto';
import {
  assessmentItems,
  assessments,
  enrollments,
  nodeProgress,
  nodes,
  questions,
  skills,
  users,
  type Assessment,
  type AssessmentItem,
  type Db,
  type ExamSkillResult,
  type Question,
} from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { loadConfig } from '../config';
import { CourseError, type CourseErrorCode } from '../courses/errors';
import type { CourseIssue } from '../courses/graph';
import { loadVersion, type Tx } from '../courses/service';
import { logEvent } from '../learning/events';
import { toStudentQuestion } from '../questions/dto';
import { gradeAnswer } from '../questions/grading';
import { studentAnswer } from '../questions/schema';
import { assertQuestionsInPool } from '../questions/service';
import { examCooldownSeconds } from '../time';
import {
  assembleExam,
  examClock,
  examProfile,
  examRounds,
  scoreExam,
  type ExamClock,
  type ExamProfile,
  type QuestionLimits,
  type RoundState,
} from './rules';

export interface ExamSettings {
  profiles: ExamProfile[];
  limits: QuestionLimits;
  passPct: number;
  perfectPct: number;
  attemptsPerRound: number;
  /** Already scaled by TIME_SCALE. */
  cooldownSeconds: number;
  maxInterruptions: number;
  openPassThreshold: number;
}

/** The exam's settings from env config, with the pause already scaled for demo mode (P2, D-32). */
export function examSettings(config = loadConfig()): ExamSettings {
  return {
    profiles: config.exam.profiles,
    limits: {
      choiceSeconds: config.exam.choiceQuestionSeconds,
      openSeconds: config.exam.openQuestionSeconds,
    },
    passPct: config.exam.passPct,
    perfectPct: config.exam.perfectPct,
    attemptsPerRound: config.exam.attemptsPerRound,
    cooldownSeconds: examCooldownSeconds(config),
    maxInterruptions: config.exam.maxInterruptions,
    openPassThreshold: config.questions.openPassThreshold,
  };
}

const student = (user: AuthUser | null) =>
  requireRole(user, 'student', 'author', 'expert', 'admin');

const lockUserExam = (tx: Tx, userId: string, versionId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`exam:${userId}:${versionId}`}))`);

interface ExamRow {
  item: AssessmentItem;
  question: Question;
  skillName: string;
}

interface Settled {
  a: Assessment;
  rows: ExamRow[];
  current: ExamClock['current'];
  /** Questions that ran out of time during this call. */
  missedIds: string[];
}

async function loadRows(db: Db | Tx, assessmentId: string): Promise<ExamRow[]> {
  const rows = await db
    .select({ item: assessmentItems, question: questions, skillName: skills.name })
    .from(assessmentItems)
    .innerJoin(questions, eq(questions.id, assessmentItems.questionId))
    .innerJoin(skills, eq(skills.id, questions.skillId))
    .where(eq(assessmentItems.assessmentId, assessmentId))
    .orderBy(asc(assessmentItems.ord));
  return rows;
}

async function loadOwnExam(db: Db | Tx, user: AuthUser, examId: string) {
  const [row] = z.uuid().safeParse(examId).success
    ? await db.select().from(assessments).where(eq(assessments.id, examId))
    : [];
  if (!row || row.userId !== user.id || row.kind !== 'exam') {
    throw new CourseError('assessment_not_found');
  }
  return row;
}

async function attemptRows(db: Db | Tx, userId: string, versionId: string) {
  return db
    .select()
    .from(assessments)
    .where(
      and(
        eq(assessments.userId, userId),
        eq(assessments.courseVersionId, versionId),
        eq(assessments.kind, 'exam'),
      ),
    )
    .orderBy(asc(assessments.startedAt));
}

/** The attempt the student left half-way: the newest row of the current attempt, if it was interrupted. */
function pendingResume(rows: Assessment[], state: RoundState) {
  const mine = rows.filter((r) => r.roundNo === state.roundNo && r.attemptNo === state.attemptNo);
  const latest = mine[mine.length - 1];
  return latest?.status === 'interrupted' ? latest : undefined;
}

const roundRules = (s: ExamSettings) => ({
  attemptsPerRound: s.attemptsPerRound,
  cooldownSeconds: s.cooldownSeconds,
});

// ---------------------------------------------------------------- the clock and finishing

/**
 * Locks the exam and brings it up to `now`: questions whose time ran out are closed with no points, the next
 * question is marked shown, and when nothing is left the exam is graded. Every call into an exam goes through
 * here first, so a deadline holds whether the student is looking or not (P1, F8-R3).
 */
async function settle(
  tx: Tx,
  assessmentId: string,
  settings: ExamSettings,
  now: Date,
): Promise<Settled> {
  const [a] = await tx
    .select()
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .for('update');
  let rows = await loadRows(tx, assessmentId);
  if (!a || a.status !== 'in_progress' || !a.deadlineAt) {
    return { a: a!, rows, current: null, missedIds: [] };
  }
  const clock = examClock({
    items: rows.map((r) => ({
      id: r.item.id,
      ord: r.item.ord,
      kind: r.question.kind,
      shownAt: r.item.shownAt,
      answeredAt: r.item.answeredAt,
    })),
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    limits: settings.limits,
    now,
  });
  for (const m of clock.missed) {
    await tx
      .update(assessmentItems)
      .set({
        shownAt: m.shownAt,
        answeredAt: m.at,
        // A draft is dropped: only an answer given in time is scored.
        answer: { timedOut: true },
        isCorrect: false,
        score: 0,
        gradedBy: 'auto',
        timeMs: m.at.getTime() - m.shownAt.getTime(),
      })
      .where(and(eq(assessmentItems.id, m.id), isNull(assessmentItems.answeredAt)));
    await logEvent(
      tx,
      a.userId,
      'question_timed_out',
      { assessmentId: a.id, itemId: m.id },
      a.courseVersionId,
    );
  }
  const row = clock.current && rows.find((r) => r.item.id === clock.current!.id)!;
  if (clock.current && row && !row.item.shownAt) {
    await tx
      .update(assessmentItems)
      .set({ shownAt: clock.current.shownAt })
      .where(eq(assessmentItems.id, clock.current.id));
  }
  if (clock.missed.length > 0 || clock.current) rows = await loadRows(tx, assessmentId);
  if (!clock.current) {
    const endedAt = clock.missed[clock.missed.length - 1]?.at ?? now;
    const finished = await finishExam(tx, a, rows, settings, endedAt);
    return { a: finished, rows, current: null, missedIds: clock.missed.map((m) => m.id) };
  }
  return { a, rows, current: clock.current, missedIds: clock.missed.map((m) => m.id) };
}

/** Grades the exam from the points of its questions (F8-R4, F8-R7). `forced` fails it whatever the points. */
async function finishExam(
  tx: Tx,
  a: Assessment,
  rows: ExamRow[],
  settings: ExamSettings,
  endedAt: Date,
  forced?: 'interruptions_exceeded',
): Promise<Assessment> {
  const skillNames = new Map(rows.map((r) => [r.question.skillId, r.skillName]));
  const score = scoreExam(
    rows.map((r) => ({ skillId: r.question.skillId, score: r.item.score ?? 0 })),
    [...skillNames]
      .map(([skillId, name]) => ({ skillId, name }))
      .sort((x, y) => x.name.localeCompare(y.name)),
    settings,
  );
  const passed = !forced && score.passed;
  const [done] = await tx
    .update(assessments)
    .set({
      status: passed ? 'passed' : 'failed',
      submittedAt: endedAt,
      scorePct: score.scorePct,
      perSkill: score.perSkill,
      meta: forced ? { ...(a.meta as object), reason: forced } : a.meta,
    })
    .where(eq(assessments.id, a.id))
    .returning();
  await logEvent(
    tx,
    a.userId,
    'exam_submitted',
    {
      assessmentId: a.id,
      passed,
      scorePct: score.scorePct,
      roundNo: a.roundNo,
      attemptNo: a.attemptNo,
      reason: forced ?? null,
    },
    a.courseVersionId,
  );
  return done!;
}

// ---------------------------------------------------------------- what the student sees

async function present(db: Db | Tx, s: Settled, settings: ExamSettings, now: Date) {
  const { a, rows, current } = s;
  const running = a.status === 'in_progress';
  const answered = rows.filter((r) => r.item.answeredAt).length;
  const cur = current && rows.find((r) => r.item.id === current.id);
  const meta = a.meta as { reason?: string };
  const finished = a.status === 'passed' || a.status === 'failed';
  const state = finished
    ? examRounds(await attemptRows(db, a.userId, a.courseVersionId), roundRules(settings), now)
    : null;
  return {
    id: a.id,
    versionId: a.courseVersionId,
    status: a.status,
    roundNo: a.roundNo,
    attemptNo: a.attemptNo,
    attemptsPerRound: settings.attemptsPerRound,
    interruptions: a.interruptions,
    maxInterruptions: settings.maxInterruptions,
    total: rows.length,
    answered,
    serverNow: now,
    deadlineAt: a.deadlineAt,
    // One question at a time and no way back: nothing but the current question leaves the server (D-18b).
    current:
      running && current && cur
        ? {
            itemId: cur.item.id,
            position: answered + 1,
            question: toStudentQuestion(cur.question),
            shownAt: current.shownAt,
            deadlineAt: current.deadline,
            draft: cur.item.answer ?? null,
          }
        : null,
    canResume: a.status === 'interrupted' && a.interruptions <= settings.maxInterruptions,
    // No verdicts per question: the exam pool is not to be learned from (F3-R2).
    result:
      finished && state
        ? {
            passed: a.status === 'passed',
            scorePct: a.scorePct,
            passPct: settings.passPct * 100,
            perSkill: (a.perSkill ?? []) as ExamSkillResult[],
            reason: meta.reason ?? null,
            attemptsLeft: state.attemptsLeft,
            cooldownUntil: state.cooldownUntil,
          }
        : null,
  };
}
export type ExamView = Awaited<ReturnType<typeof present>>;

// ---------------------------------------------------------------- eligibility

async function loadExamPool(db: Db | Tx, versionId: string) {
  const skillRows = await db
    .select({ id: skills.id, name: skills.name })
    .from(skills)
    .where(eq(skills.courseVersionId, versionId))
    .orderBy(asc(skills.name));
  const pool = await db
    .select({ id: questions.id, skillId: questions.skillId })
    .from(questions)
    .innerJoin(nodes, eq(nodes.id, questions.nodeId))
    .where(
      and(
        eq(nodes.courseVersionId, versionId),
        eq(questions.pool, 'exam'),
        eq(questions.status, 'validated'),
      ),
    )
    .orderBy(asc(questions.id));
  return {
    skills: skillRows.map((s) => ({
      skillId: s.id,
      name: s.name,
      questionIds: pool.filter((q) => q.skillId === s.id).map((q) => q.id),
    })),
    size: pool.length,
  };
}

async function nodesPassed(db: Db | Tx, userId: string, versionId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) FILTER (WHERE ${nodeProgress.state} = 'passed')::int`,
    })
    .from(nodes)
    .leftJoin(nodeProgress, and(eq(nodeProgress.nodeId, nodes.id), eq(nodeProgress.userId, userId)))
    .where(eq(nodes.courseVersionId, versionId));
  return { total: row?.total ?? 0, passed: row?.passed ?? 0 };
}

interface Blocker {
  code: CourseErrorCode;
  issues?: CourseIssue[];
}

/** F8-R1: why the student cannot start now, in the order they would need to fix it; `null` when they can. */
async function startBlocker(
  db: Db | Tx,
  p: { userId: string; versionId: string; state: RoundState; now: Date },
): Promise<Blocker | null> {
  const [enrolled] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, p.userId), eq(enrollments.courseVersionId, p.versionId)));
  if (!enrolled) return { code: 'not_enrolled' };
  if (p.state.passed) return { code: 'exam_passed' };
  const [user] = await db
    .select({ until: users.examBanUntil, forever: users.examBannedForever })
    .from(users)
    .where(eq(users.id, p.userId));
  if (user?.forever || (user?.until && user.until > p.now)) return { code: 'exam_banned' };
  const done = await nodesPassed(db, p.userId, p.versionId);
  if (done.total === 0 || done.passed < done.total) return { code: 'exam_not_eligible' };
  if (p.state.cooldownUntil && p.now < p.state.cooldownUntil) return { code: 'exam_cooldown' };
  return null;
}

// ---------------------------------------------------------------- status and start

/** The pre-check screen's data: eligibility, rules for this course and where the student stands in the rounds. */
export async function getExamStatus(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  settings: ExamSettings,
  now = new Date(),
) {
  const { version, user: actor } = await loadVersion(db, student(user), versionId);
  if (version.status !== 'published') throw new CourseError('version_not_published');
  // An exam that ran out of time while the student was away is closed first, so the numbers below are current.
  const open = await attemptRows(db, actor.id, versionId);
  for (const row of open.filter((r) => r.status === 'in_progress')) {
    await db.transaction((tx) => settle(tx, row.id, settings, now));
  }
  const rows = await attemptRows(db, actor.id, versionId);
  const state = examRounds(rows, roundRules(settings), now);
  const [pool, progress, [banRow]] = await Promise.all([
    loadExamPool(db, versionId),
    nodesPassed(db, actor.id, versionId),
    db
      .select({ until: users.examBanUntil, forever: users.examBannedForever })
      .from(users)
      .where(eq(users.id, actor.id)),
  ]);
  const profile = examProfile(settings.profiles, version.rating);
  const running = rows.find((r) => r.status === 'in_progress');
  const interrupted = pendingResume(rows, state);
  const poolOk = assembleExam({ skills: pool.skills, total: profile.questions, seed: 1 }).ok;
  const blocker = running
    ? null
    : ((await startBlocker(db, { userId: actor.id, versionId, state, now })) ??
      (poolOk ? null : { code: 'test_unavailable' as const }));
  const banned =
    banRow?.forever || (banRow?.until && banRow.until > now)
      ? { forever: !!banRow.forever, until: banRow.until }
      : null;
  return {
    versionId,
    title: version.title,
    nodes: progress,
    ban: banned,
    passed: state.passed,
    runningId: running?.id ?? null,
    interrupted: interrupted
      ? { id: interrupted.id, interruptions: interrupted.interruptions }
      : null,
    roundNo: state.roundNo,
    attemptNo: state.attemptNo,
    attemptsPerRound: settings.attemptsPerRound,
    attemptsLeft: state.attemptsLeft,
    cooldownUntil: state.cooldownUntil,
    maxInterruptions: settings.maxInterruptions,
    rules: {
      // The pool may be smaller than the rating asks for; then the exam is as long as the pool.
      questions: Math.min(profile.questions, pool.size),
      minutes: profile.minutes,
      choiceSeconds: settings.limits.choiceSeconds,
      openSeconds: settings.limits.openSeconds,
      passPct: settings.passPct * 100,
    },
    canStart: !blocker,
    blockedBy: blocker?.code ?? null,
    history: rows
      .filter((r) => ['passed', 'failed', 'annulled'].includes(r.status))
      .map((r) => ({
        id: r.id,
        roundNo: r.roundNo,
        attemptNo: r.attemptNo,
        status: r.status,
        scorePct: r.scorePct,
        submittedAt: r.submittedAt,
      })),
  };
}

/**
 * Starts the next attempt, resumes an interrupted one with a freshly drawn set (F8-R6), or returns the exam that
 * is already running. Eligibility, ban, rounds and the pause are all decided here (P1, F8-R1, F8-R5).
 */
export async function startExam(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  settings: ExamSettings,
  now = new Date(),
  seed = randomInt(1, 2 ** 31),
) {
  const { version, user: actor } = await loadVersion(db, student(user), versionId);
  if (version.status !== 'published') throw new CourseError('version_not_published');
  const id = await db.transaction(async (tx) => {
    await lockUserExam(tx, actor.id, versionId);
    for (const row of await attemptRows(tx, actor.id, versionId)) {
      if (row.status === 'in_progress') await settle(tx, row.id, settings, now);
    }
    const rows = await attemptRows(tx, actor.id, versionId);
    const running = rows.find((r) => r.status === 'in_progress');
    if (running) return running.id;

    const state = examRounds(rows, roundRules(settings), now);
    const blocker = await startBlocker(tx, { userId: actor.id, versionId, state, now });
    if (blocker) throw new CourseError(blocker.code, blocker.issues);

    const profile = examProfile(settings.profiles, version.rating);
    const pool = await loadExamPool(tx, versionId);
    const assembly = assembleExam({ skills: pool.skills, total: profile.questions, seed });
    if (!assembly.ok) {
      const names = new Map(pool.skills.map((s) => [s.skillId, s.name]));
      throw new CourseError(
        'test_unavailable',
        assembly.emptySkillIds.length
          ? assembly.emptySkillIds.map((skillId) => ({
              code: 'pool_too_small' as const,
              message: `No validated exam-pool questions for skill "${names.get(skillId)}".`,
              skillId,
              pool: 'exam' as const,
            }))
          : [{ code: 'pool_too_small' as const, message: 'The course has no skills.' }],
      );
    }
    // D-17: whatever the query did, a node or assessment question must never reach the exam.
    await assertQuestionsInPool(tx, assembly.questionIds, 'exam');

    // A resumed attempt keeps its number and its interruptions, and the time it had left (F8-R6).
    const earlier = pendingResume(rows, state);
    const earlierMeta = (earlier?.meta ?? {}) as { remainingSeconds?: number };
    const totalSeconds = earlierMeta.remainingSeconds ?? profile.minutes * 60;
    const [created] = await tx
      .insert(assessments)
      .values({
        userId: actor.id,
        kind: 'exam',
        courseVersionId: versionId,
        roundNo: state.roundNo,
        attemptNo: state.attemptNo,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + totalSeconds * 1000),
        interruptions: earlier?.interruptions ?? 0,
        questionSetSeed: seed,
        meta: {
          rating: version.rating,
          questions: assembly.questionIds.length,
          totalSeconds,
          ...(earlier ? { resumedFrom: earlier.id } : {}),
        },
      })
      .returning({ id: assessments.id });
    await tx.insert(assessmentItems).values(
      assembly.questionIds.map((questionId, ord) => ({
        assessmentId: created!.id,
        questionId,
        ord,
        shownAt: ord === 0 ? now : null,
      })),
    );
    await logEvent(
      tx,
      actor.id,
      'exam_started',
      {
        assessmentId: created!.id,
        roundNo: state.roundNo,
        attemptNo: state.attemptNo,
        questions: assembly.questionIds.length,
        resumed: !!earlier,
      },
      versionId,
    );
    return created!.id;
  });
  return getExam(db, actor, id, settings, now);
}

// ---------------------------------------------------------------- taking the exam

/** The exam as the student sees it now. Opening it also closes whatever ran out of time. */
export async function getExam(
  db: Db,
  user: AuthUser | null,
  examId: string,
  settings: ExamSettings,
  now = new Date(),
): Promise<ExamView> {
  const actor = student(user);
  const own = await loadOwnExam(db, actor, examId);
  const settled = await db.transaction((tx) => settle(tx, own.id, settings, now));
  return present(db, settled, settings, now);
}

/** Why an answer to `itemId` cannot be taken now. `s` is the state after the clock was applied. */
function refuse(s: Settled, itemId: string): CourseError {
  const row = s.rows.find((r) => r.item.id === itemId);
  if (!row) return new CourseError('assessment_not_found');
  if (
    s.missedIds.includes(itemId) ||
    (row.item.answer as { timedOut?: boolean } | null)?.timedOut
  ) {
    return new CourseError('exam_time_expired');
  }
  if (s.a.status !== 'in_progress') return new CourseError('assessment_closed');
  if (row.item.answeredAt) return new CourseError('already_answered');
  return new CourseError('exam_not_current');
}

/**
 * Autosave of what the student has typed so far (F8-R3). It only restores the text after a reload; the grade
 * comes from the final answer, so a draft left at the deadline is not scored.
 */
export async function saveExamDraft(
  db: Db,
  user: AuthUser | null,
  examId: string,
  itemId: string,
  answer: unknown,
  settings: ExamSettings,
  now = new Date(),
) {
  const actor = student(user);
  const own = await loadOwnExam(db, actor, examId);
  const s = await db.transaction((tx) => settle(tx, own.id, settings, now));
  if (s.current?.id !== itemId) throw refuse(s, itemId);
  const row = s.rows.find((r) => r.item.id === itemId)!;
  const parsed = studentAnswer[row.question.kind].safeParse(answer);
  if (!parsed.success) throw new CourseError('invalid_question');
  await db
    .update(assessmentItems)
    .set({ answer: parsed.data })
    .where(and(eq(assessmentItems.id, itemId), isNull(assessmentItems.answeredAt)));
  return { saved: true };
}

/**
 * Grades one answer on the server and moves to the next question; the last answer ends the exam (F8-R3).
 * An answer after the question's deadline, or the exam's, is refused whatever the client believes (P1).
 */
export async function answerExam(
  db: Db,
  llm: LLMClient,
  user: AuthUser | null,
  examId: string,
  itemId: string,
  answer: unknown,
  settings: ExamSettings,
  now = new Date(),
) {
  const actor = student(user);
  const own = await loadOwnExam(db, actor, examId);
  const first = await db.transaction((tx) => settle(tx, own.id, settings, now));
  if (first.current?.id !== itemId) throw refuse(first, itemId);
  const question = first.rows.find((r) => r.item.id === itemId)!.question;
  const parsed = studentAnswer[question.kind].safeParse(answer);
  if (!parsed.success) throw new CourseError('invalid_question');

  // The LLM call (short/open) stays outside the transaction; the write below checks the clock again.
  const grade = await gradeAnswer(
    { llm, openPassThreshold: settings.openPassThreshold },
    question,
    answer,
  );

  await db.transaction(async (tx) => {
    const s = await settle(tx, own.id, settings, now);
    if (s.current?.id !== itemId) throw refuse(s, itemId);
    const [saved] = await tx
      .update(assessmentItems)
      .set({
        answer: parsed.data,
        answeredAt: now,
        isCorrect: grade.isCorrect,
        score: grade.score,
        gradedBy: grade.gradedBy,
        graderRunId: grade.graderRunId ?? null,
        timeMs: Math.max(0, now.getTime() - s.current.shownAt.getTime()),
      })
      .where(and(eq(assessmentItems.id, itemId), isNull(assessmentItems.answeredAt)))
      .returning({ id: assessmentItems.id });
    if (!saved) throw new CourseError('already_answered');
    await logEvent(
      tx,
      actor.id,
      'question_answered',
      {
        assessmentId: s.a.id,
        kind: 'exam',
        questionId: question.id,
        skillId: question.skillId,
        isCorrect: grade.isCorrect,
        score: grade.score,
      },
      s.a.courseVersionId,
    );
    // The next question starts now; with none left the exam is graded.
    const rows = await loadRows(tx, s.a.id);
    const next = rows.find((r) => !r.item.answeredAt);
    if (next) {
      await tx
        .update(assessmentItems)
        .set({ shownAt: now })
        .where(eq(assessmentItems.id, next.item.id));
    } else {
      await finishExam(tx, s.a, rows, settings, now);
    }
  });
  return getExam(db, actor, examId, settings, now);
}

const interruptReason = z.enum(['network', 'camera', 'other']).catch('other');

/**
 * F8-R6: a technical interruption (network, camera) stops the attempt with no strike. The time left is kept for
 * the resumption, which draws a new set. The interruption over the limit ends the attempt as used.
 */
export async function interruptExam(
  db: Db,
  user: AuthUser | null,
  examId: string,
  reason: unknown,
  settings: ExamSettings,
  now = new Date(),
) {
  const actor = student(user);
  const own = await loadOwnExam(db, actor, examId);
  await db.transaction(async (tx) => {
    const s = await settle(tx, own.id, settings, now);
    if (s.a.status !== 'in_progress') throw new CourseError('assessment_closed');
    const interruptions = s.a.interruptions + 1;
    const exceeded = interruptions > settings.maxInterruptions;
    const why = interruptReason.parse(reason);
    await tx.update(assessments).set({ interruptions }).where(eq(assessments.id, s.a.id));
    if (exceeded) {
      await finishExam(
        tx,
        { ...s.a, interruptions },
        s.rows,
        settings,
        now,
        'interruptions_exceeded',
      );
    } else {
      const remainingSeconds = Math.max(
        1,
        Math.round((s.a.deadlineAt!.getTime() - now.getTime()) / 1000),
      );
      await tx
        .update(assessments)
        .set({
          status: 'interrupted',
          submittedAt: now,
          meta: { ...(s.a.meta as object), remainingSeconds, interruptReason: why },
        })
        .where(eq(assessments.id, s.a.id));
    }
    await logEvent(
      tx,
      actor.id,
      'exam_interrupted',
      { assessmentId: s.a.id, reason: why, interruptions, exceeded },
      s.a.courseVersionId,
    );
  });
  return getExam(db, actor, examId, settings, now);
}
