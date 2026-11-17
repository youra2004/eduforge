import {
  assessmentItems,
  assessments,
  llmRuns,
  nodeEdges,
  nodeProgress,
  questions,
  staticHints,
  tutorMessages,
  tutorSessions,
  type Db,
  type Question,
} from '@eduforge/db';
import type { EmbeddingClient, LLMClient } from '@eduforge/llm';
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { retrieve } from '../content/retrieve';
import { CourseError } from '../courses/errors';
import type { Tx } from '../courses/service';
import { assertNodeAccess } from '../learning/access';
import { logEvent } from '../learning/events';
import { toStudentQuestion } from '../questions/dto';
import { answerKeys } from '../questions/schema';
import { chooseLevel, lowerLevel, type HintLevel } from './level';
import {
  GENERIC_HINTS,
  GUARD_SYSTEM,
  GUARD_VERSION,
  guardPrompt,
  TUTOR_SYSTEM,
  TUTOR_VERSION,
  tutorPrompt,
} from './prompts';
import { guardOutput, tutorInput, tutorOutput, type TutorInput } from './schema';

export interface TutorDeps {
  llm: LLMClient;
  embedder: EmbeddingClient;
  /** Per-user limits (NFR-4, NFR-7). */
  limits: { ratePerMinute: number; dailyTokenBudget: number };
}

/** How many chunks go into the prompt, and how many earlier messages. */
const CHUNKS = 4;
const HISTORY = 6;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface Attempt {
  level: HintLevel;
  revealed: boolean | null;
  reason: string;
  tutorRunId: string | null;
  guardRunId: string | null;
}

/** What is stored in `tutor_messages.guard_verdict` (F6-R8, H4). */
export interface GuardVerdict {
  /** `llm`: the shown hint passed the guard. `static`: the author's (or the generic) hint was shown instead. */
  source: 'llm' | 'static';
  fallbackReason: 'provider_error' | 'guard_error' | 'guard_violation' | null;
  attempts: Attempt[];
}

/**
 * F6-R2: the node itself plus the prerequisites this student has passed. The student never sees anything
 * else, whatever they ask; the filter goes into the SQL of `retrieve`, not into the prompt.
 */
export async function allowedNodeIds(db: Db, userId: string, nodeId: string): Promise<string[]> {
  const rows = await db
    .select({ id: nodeEdges.prereqNodeId })
    .from(nodeEdges)
    .innerJoin(
      nodeProgress,
      and(eq(nodeProgress.nodeId, nodeEdges.prereqNodeId), eq(nodeProgress.userId, userId)),
    )
    .where(and(eq(nodeEdges.nodeId, nodeId), eq(nodeProgress.state, 'passed')));
  return [nodeId, ...rows.map((r) => r.id)];
}

/**
 * F6-R1: help is for learning, not for a test that is being taken. Any running assessment of the student
 * closes the tutor, whichever node it is on, so another node's chat cannot be used to coach a running test.
 */
async function assertTutorAvailable(db: Db | Tx, userId: string) {
  const [running] = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(and(eq(assessments.userId, userId), eq(assessments.status, 'in_progress')))
    .limit(1);
  if (running) throw new CourseError('tutor_unavailable');
}

/** Rate limit and daily budget, both read from the log so they hold across restarts and servers. */
async function assertWithinLimits(
  db: Db | Tx,
  userId: string,
  limits: TutorDeps['limits'],
  now: Date,
) {
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tutorMessages)
    .innerJoin(tutorSessions, eq(tutorSessions.id, tutorMessages.sessionId))
    .where(
      and(
        eq(tutorSessions.userId, userId),
        eq(tutorMessages.role, 'student'),
        gt(tutorMessages.createdAt, new Date(now.getTime() - MINUTE)),
      ),
    );
  if ((recent?.n ?? 0) >= limits.ratePerMinute) throw new CourseError('tutor_rate_limited');

  // Tutor and guard calls both carry the session as their subject, so one sum covers the lot.
  const [spent] = await db
    .select({
      tokens: sql<number>`coalesce(sum(${llmRuns.tokensIn} + ${llmRuns.tokensOut}), 0)::int`,
    })
    .from(llmRuns)
    .innerJoin(tutorSessions, eq(tutorSessions.id, llmRuns.subjectId))
    .where(
      and(
        eq(llmRuns.subjectType, 'tutor_session'),
        eq(tutorSessions.userId, userId),
        gt(llmRuns.createdAt, new Date(now.getTime() - DAY)),
      ),
    );
  if ((spent?.tokens ?? 0) >= limits.dailyTokenBudget)
    throw new CourseError('tutor_budget_exceeded');
}

/** The question as the tutor may see it, or a 404. Only validated node-pool questions of this node (P6, D-17). */
async function loadQuestion(db: Db, nodeId: string, questionId: string): Promise<Question> {
  const [q] = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.id, questionId),
        eq(questions.nodeId, nodeId),
        eq(questions.pool, 'node'),
        eq(questions.status, 'validated'),
      ),
    );
  if (!q) throw new CourseError('question_not_found');
  return q;
}

/** The student's answer from their last finished test, as text; null if they never answered it there. */
async function lastTestAnswer(db: Db, userId: string, q: Question): Promise<string | null> {
  const [row] = await db
    .select({ answer: assessmentItems.answer })
    .from(assessmentItems)
    .innerJoin(assessments, eq(assessments.id, assessmentItems.assessmentId))
    .where(
      and(
        eq(assessments.userId, userId),
        eq(assessmentItems.questionId, q.id),
        isNotNull(assessmentItems.answeredAt),
      ),
    )
    .orderBy(desc(assessmentItems.answeredAt))
    .limit(1);
  const a = row?.answer as { optionIndex?: number; text?: string } | null | undefined;
  if (!a) return null;
  if (q.kind === 'mcq') return q.options?.[a.optionIndex ?? -1] ?? null;
  return a.text ?? null;
}

/** The key as text, for the guard only: it judges the reply against it and the tutor never sees it. */
function referenceAnswer(q: Question): string {
  if (q.kind === 'mcq') return q.options?.[answerKeys.mcq.parse(q.answerKey).optionIndex] ?? '';
  if (q.kind === 'short') return answerKeys.short.parse(q.answerKey).accepted.join(' / ');
  return answerKeys.open.parse(q.answerKey).reference;
}

/** F6-R6: the author's hint for this question, else for this node, at the highest level not above `level`; else a generic one. */
export async function staticHint(
  db: Db,
  nodeId: string,
  questionId: string | null,
  level: HintLevel,
): Promise<string> {
  const rows = await db
    .select()
    .from(staticHints)
    .where(
      and(
        eq(staticHints.nodeId, nodeId),
        lte(staticHints.level, level),
        questionId
          ? or(isNull(staticHints.questionId), eq(staticHints.questionId, questionId))
          : isNull(staticHints.questionId),
      ),
    )
    .orderBy(desc(staticHints.level), asc(staticHints.id));
  // A hint written for this very question beats a node-level one of the same or a higher level.
  const own = rows.find((r) => r.questionId === questionId && questionId !== null);
  return (own ?? rows[0])?.text ?? GENERIC_HINTS[level];
}

/**
 * One tutor turn. Returns a hint that passed the guard, or the author's static hint; never an LLM failure (F6-R6).
 * Order: checks (access, availability, limits) → log the student's message → retrieve → hint → guard → log the reply.
 */
export async function askTutor(
  db: Db,
  deps: TutorDeps,
  user: AuthUser | null,
  nodeId: string,
  rawInput: TutorInput,
  now = new Date(),
) {
  const parsed = tutorInput.safeParse(rawInput);
  if (!parsed.success) throw new CourseError('invalid_tutor_input');
  const input = parsed.data;
  const { actor } = await assertNodeAccess(
    db,
    requireRole(user, 'student', 'author', 'expert', 'admin'),
    nodeId,
  );

  const question = input.questionId ? await loadQuestion(db, nodeId, input.questionId) : null;
  const studentAnswer =
    input.studentAnswer || (question ? await lastTestAnswer(db, actor.id, question) : null) || null;

  // One transaction per user at a time: parallel requests cannot all pass the limit check before any of
  // them has logged its message (NFR-4).
  const { sessionId, level, history } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'tutor:' + actor.id}))`);
    await assertTutorAvailable(tx, actor.id);
    await assertWithinLimits(tx, actor.id, deps.limits, now);

    let id: string;
    if (input.sessionId) {
      const [s] = await tx
        .select()
        .from(tutorSessions)
        .where(and(eq(tutorSessions.id, input.sessionId), eq(tutorSessions.userId, actor.id)));
      // A session belongs to one node and one question; anything else is treated as not found.
      if (!s || s.nodeId !== nodeId || (s.questionId ?? null) !== (question?.id ?? null)) {
        throw new CourseError('question_not_found');
      }
      id = s.id;
    } else {
      const [created] = await tx
        .insert(tutorSessions)
        .values({ userId: actor.id, nodeId, questionId: question?.id, createdAt: now })
        .returning({ id: tutorSessions.id });
      id = created!.id;
    }
    const earlier = await tx
      .select()
      .from(tutorMessages)
      .where(eq(tutorMessages.sessionId, id))
      .orderBy(asc(tutorMessages.createdAt), asc(tutorMessages.id));
    await tx
      .insert(tutorMessages)
      .values({ sessionId: id, role: 'student', content: input.message, createdAt: now });
    return {
      sessionId: id,
      level: chooseLevel(earlier.filter((m) => m.role === 'tutor').length),
      history: earlier.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content })),
    };
  });

  const outcome = await produceHint(db, deps, {
    sessionId: sessionId,
    userId: actor.id,
    nodeId,
    question,
    studentAnswer,
    message: input.message,
    level,
    history,
  });

  const [saved] = await db
    .insert(tutorMessages)
    .values({
      sessionId: sessionId,
      role: 'tutor',
      content: outcome.hint,
      hintLevel: outcome.level,
      guardVerdict: outcome.verdict,
      retrievedChunkIds: outcome.chunkIds,
      llmRunId: outcome.runId,
      createdAt: new Date(now.getTime() + 1),
    })
    .returning({ id: tutorMessages.id });
  await logEvent(db, actor.id, 'tutor_message', {
    nodeId,
    questionId: question?.id ?? null,
    sessionId,
    hintLevel: outcome.level,
    source: outcome.verdict.source,
  });
  return {
    sessionId: sessionId,
    message: {
      id: saved!.id,
      content: outcome.hint,
      hintLevel: outcome.level,
      source: outcome.verdict.source,
    },
  };
}

interface HintJob {
  sessionId: string;
  userId: string;
  nodeId: string;
  question: Question | null;
  studentAnswer: string | null;
  message: string;
  level: HintLevel;
  history: { role: 'student' | 'tutor'; content: string }[];
}

/** Generate → guard → (one retry a level lower) → static hint. Every failure path ends in a static hint. */
async function produceHint(db: Db, deps: TutorDeps, job: HintJob) {
  const attempts: Attempt[] = [];
  const subject = { type: 'tutor_session', id: job.sessionId };
  const visible = job.question ? toStudentQuestion(job.question) : null;
  const shown = visible && { promptMd: visible.promptMd, options: visible.options };
  let chunkIds: string[] = [];
  let fallbackReason: GuardVerdict['fallbackReason'] = null;

  try {
    const chunks = await retrieve(db, deps.embedder, {
      allowedNodeIds: await allowedNodeIds(db, job.userId, job.nodeId),
      query: [shown?.promptMd, job.studentAnswer, job.message].filter(Boolean).join('\n'),
      k: CHUNKS,
    });
    chunkIds = chunks.map((c) => c.chunkId);

    // At most two tries: the asked level, then one level lower (ADR-0009).
    const tries = [job.level, lowerLevel(job.level)].filter((l): l is HintLevel => l !== null);
    for (const level of tries) {
      const attempt: Attempt = {
        level,
        revealed: null,
        reason: '',
        tutorRunId: null,
        guardRunId: null,
      };
      attempts.push(attempt);
      let hint: string;
      try {
        const run = await deps.llm.generate({
          purpose: 'tutor',
          promptVersion: TUTOR_VERSION,
          system: TUTOR_SYSTEM,
          prompt: tutorPrompt({
            level,
            question: shown,
            studentAnswer: job.studentAnswer,
            history: job.history,
            message: job.message,
            chunks: chunks.map((c) => ({ id: c.chunkId, text: c.text })),
          }),
          schema: tutorOutput,
          params: { level },
          cache: false,
          subject,
        });
        hint = run.data.hint;
        attempt.tutorRunId = run.runId;
      } catch (err) {
        attempt.reason = `tutor: ${String(err)}`;
        fallbackReason = 'provider_error';
        break;
      }
      try {
        const guard = await deps.llm.generate({
          purpose: 'tutor_guard',
          promptVersion: GUARD_VERSION,
          system: GUARD_SYSTEM,
          prompt: guardPrompt(shown, job.question ? referenceAnswer(job.question) : null, hint),
          schema: guardOutput,
          cache: false,
          subject,
        });
        attempt.revealed = guard.data.revealed;
        attempt.reason = guard.data.reason;
        attempt.guardRunId = guard.runId;
      } catch (err) {
        // A reply nobody checked is not shown.
        attempt.reason = `guard: ${String(err)}`;
        fallbackReason = 'guard_error';
        break;
      }
      if (!attempt.revealed) {
        return {
          hint,
          level,
          chunkIds,
          runId: attempt.tutorRunId,
          verdict: { source: 'llm', fallbackReason: null, attempts } satisfies GuardVerdict,
        };
      }
      fallbackReason = 'guard_violation';
    }
  } catch (err) {
    // Retrieval (the embedding API or the database) failed.
    attempts.push({
      level: job.level,
      revealed: null,
      reason: `retrieval: ${String(err)}`,
      tutorRunId: null,
      guardRunId: null,
    });
    fallbackReason = 'provider_error';
  }

  return {
    hint: await staticHint(db, job.nodeId, job.question?.id ?? null, job.level),
    level: job.level,
    chunkIds,
    runId: null,
    verdict: { source: 'static', fallbackReason, attempts } satisfies GuardVerdict,
  };
}
