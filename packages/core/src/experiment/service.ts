import { randomBytes, randomInt } from 'node:crypto';
import {
  assessmentItems,
  assessments,
  consents,
  courses,
  courseVersions,
  enrollments,
  eventLog,
  experimentAssignments,
  experimentParticipants,
  nodes,
  questions,
  type Assessment,
  type Db,
  type ExperimentCondition,
  type ExperimentModule,
} from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { CONSENT_VERSIONS } from '../auth/consent';
import { loadConfig } from '../config';
import { CourseError } from '../courses/errors';
import type { Tx } from '../courses/service';
import { logEvent } from '../learning/events';
import { mulberry32, shuffle } from '../learning/assemble';
import {
  getAssessment,
  loadOwnAssessment,
  answerItem,
  type LearningSettings,
} from '../learning/service';
import { gradeAnswer } from '../questions/grading';
import { assertQuestionsInPool } from '../questions/service';
import { experimentDelaySeconds } from '../time';
import { assignmentsOf, CELLS, cellIndex, chooseCell } from './assign';
import { moduleVersion } from './context';
import { moduleDone, moduleStep, type ModuleFacts, type ModuleStep } from './flow';
import { LIKERT_MAX, LIKERT_MIN, SURVEY_ITEMS } from './survey';

const participant = (user: AuthUser | null) =>
  requireRole(user, 'student', 'author', 'expert', 'admin');

export interface ExperimentSettings {
  /** Already scaled by TIME_SCALE. */
  delaySeconds: number;
  heartbeatSeconds: number;
}

export function experimentSettings(config = loadConfig()): ExperimentSettings {
  return {
    delaySeconds: experimentDelaySeconds(config),
    heartbeatSeconds: config.experiment.heartbeatSeconds,
  };
}

export type StudyTestKind = 'pretest' | 'posttest' | 'delayed_posttest';
const KIND_STEP: Record<StudyTestKind, ModuleStep> = {
  pretest: 'pretest',
  posttest: 'posttest',
  delayed_posttest: 'delayed',
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** A pseudonym like `P-7K3QX9`: random, so it says nothing about who or when. */
const newCode = () =>
  'P-' + Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

// ---------------------------------------------------------------- joining

/**
 * Joins the study after informed consent (RESEARCH.md §6): records the `research` consent, makes a pseudonym and
 * puts the participant into the emptiest of the four counterbalancing cells (D-30). Joining twice changes nothing.
 */
export async function joinExperiment(
  db: Db,
  user: AuthUser | null,
  input: unknown,
  rng: () => number = Math.random,
) {
  const actor = participant(user);
  if (!z.object({ consent: z.literal(true) }).safeParse(input).success) {
    throw new CourseError('consent_required');
  }
  await db.transaction(async (tx) => {
    // One allocation at a time, so two people joining together cannot both see the same counts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('experiment:assign'))`);
    const [existing] = await tx
      .select({ userId: experimentParticipants.userId })
      .from(experimentParticipants)
      .where(eq(experimentParticipants.userId, actor.id));
    if (existing) return;
    // Someone who has already studied a topic would skip the pre-test's meaning and the gating of the method.
    const [studied] = await tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId))
      .innerJoin(courses, eq(courses.id, courseVersions.courseId))
      .where(
        and(
          eq(enrollments.userId, actor.id),
          inArray(courses.slug, Object.values(loadConfig().experiment.courseSlugs)),
        ),
      )
      .limit(1);
    if (studied) throw new CourseError('experiment_step_not_allowed');
    const rows = await tx
      .select({
        orderVariant: experimentParticipants.orderVariant,
        aCondition: experimentAssignments.condition,
        n: sql<number>`count(*)::int`,
      })
      .from(experimentParticipants)
      .innerJoin(
        experimentAssignments,
        and(
          eq(experimentAssignments.userId, experimentParticipants.userId),
          eq(experimentAssignments.module, 'A'),
        ),
      )
      .groupBy(experimentParticipants.orderVariant, experimentAssignments.condition);
    const counts = CELLS.map(
      (c) =>
        rows.find((r) => r.orderVariant === c.orderVariant && r.aCondition === c.aCondition)?.n ??
        0,
    );
    const cell = chooseCell(counts, rng);
    let code = newCode();
    for (let i = 0; i < 5; i++) {
      const [taken] = await tx
        .select({ code: experimentParticipants.code })
        .from(experimentParticipants)
        .where(eq(experimentParticipants.code, code));
      if (!taken) break;
      code = newCode();
    }
    await tx.insert(experimentParticipants).values({
      userId: actor.id,
      code,
      orderVariant: cell.orderVariant,
    });
    await tx
      .insert(experimentAssignments)
      .values(assignmentsOf(cell).map((a) => ({ ...a, userId: actor.id })));
    await tx.insert(consents).values({
      userId: actor.id,
      kind: 'research',
      version: CONSENT_VERSIONS.research,
    });
    await logEvent(tx, actor.id, 'experiment_joined', {
      cell: cellIndex(cell),
      orderVariant: cell.orderVariant,
    });
  });
  return getParticipation(db, actor, experimentSettings());
}

// ---------------------------------------------------------------- where the participant is

export interface ModuleView {
  module: ExperimentModule;
  period: number;
  condition: ExperimentCondition;
  /** `null` while the module's course is not published. */
  versionId: string | null;
  title: string | null;
  step: ModuleStep;
  /** A test of this module that was started and not finished. */
  runningAssessmentId: string | null;
  delayedDueAt: Date | null;
}

async function loadFacts(
  db: Db | Tx,
  userId: string,
  module: ExperimentModule,
  versionId: string,
  previousDone: boolean,
) {
  const tests = await db
    .select()
    .from(assessments)
    .where(and(eq(assessments.userId, userId), eq(assessments.courseVersionId, versionId)));
  const [enrolled] = await db
    .select({ status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseVersionId, versionId)));
  const [survey] = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(
      and(
        eq(eventLog.userId, userId),
        eq(eventLog.name, 'survey_submitted'),
        sql`${eventLog.props}->>'module' = ${module}`,
      ),
    )
    .limit(1);
  const done = (kind: StudyTestKind) =>
    tests.find((t) => t.kind === kind && t.status === 'submitted');
  const facts: ModuleFacts = {
    previousDone,
    pretestDone: !!done('pretest'),
    learningFinished: enrolled?.status === 'completed',
    posttestSubmittedAt: done('posttest')?.submittedAt ?? null,
    surveyDone: !!survey,
    delayedDone: !!done('delayed_posttest'),
  };
  return { facts, tests };
}

/** The participant's two modules in the order they take them, each with its current step; `null` if not in the study. */
export async function getParticipation(
  db: Db | Tx,
  user: AuthUser | null,
  settings: ExperimentSettings,
  now = new Date(),
) {
  const actor = participant(user);
  const [me] = await db
    .select()
    .from(experimentParticipants)
    .where(eq(experimentParticipants.userId, actor.id));
  if (!me) return null;
  const mine = await db
    .select()
    .from(experimentAssignments)
    .where(eq(experimentAssignments.userId, actor.id))
    .orderBy(asc(experimentAssignments.period));

  const views: ModuleView[] = [];
  let previousDone = true;
  for (const a of mine) {
    const version = await moduleVersion(db, a.module);
    if (!version) {
      views.push({
        module: a.module,
        period: a.period,
        condition: a.condition,
        versionId: null,
        title: null,
        step: previousDone ? 'pretest' : 'waiting',
        runningAssessmentId: null,
        delayedDueAt: null,
      });
      previousDone = false;
      continue;
    }
    const { facts, tests } = await loadFacts(db, actor.id, a.module, version.id, previousDone);
    const step = moduleStep(facts, settings.delaySeconds, now);
    views.push({
      module: a.module,
      period: a.period,
      condition: a.condition,
      versionId: version.id,
      title: version.title,
      step,
      runningAssessmentId:
        tests.find((t) => t.status === 'in_progress' && t.kind === stepKind(step))?.id ?? null,
      delayedDueAt: facts.posttestSubmittedAt
        ? new Date(facts.posttestSubmittedAt.getTime() + settings.delaySeconds * 1000)
        : null,
    });
    previousDone = moduleDone(facts);
  }
  return {
    code: me.code,
    orderVariant: me.orderVariant,
    modules: views,
    /** Delayed tests that are due: the reminder the participant sees (RESEARCH.md §2). */
    reminders: views.filter((v) => v.step === 'delayed').map((v) => v.module),
  };
}

const stepKind = (step: ModuleStep): StudyTestKind | null =>
  step === 'pretest'
    ? 'pretest'
    : step === 'posttest'
      ? 'posttest'
      : step === 'delayed'
        ? 'delayed_posttest'
        : null;

async function requireStep(
  db: Db | Tx,
  user: AuthUser | null,
  module: string,
  allowed: ModuleStep,
  now: Date,
) {
  const actor = participant(user);
  const joined = await getParticipation(db, actor, experimentSettings(), now);
  if (!joined) throw new CourseError('experiment_not_joined');
  const view = joined.modules.find((v) => v.module === module);
  if (!view) throw new CourseError('course_not_found');
  if (!view.versionId) throw new CourseError('experiment_course_missing');
  if (view.step !== allowed) throw new CourseError('experiment_step_not_allowed');
  return { actor, view: { ...view, versionId: view.versionId } };
}

// ---------------------------------------------------------------- tests (pre, post, delayed)

/**
 * Starts the participant's pre-test, post-test or delayed post-test for a module, or returns the one already
 * running. The server only allows the step the participant is on (P1). The questions are the module's whole
 * `assessment` pool, the same for every participant and both conditions; only their order differs.
 */
export async function startStudyTest(
  db: Db,
  user: AuthUser | null,
  module: string,
  kind: StudyTestKind,
  learning: LearningSettings,
  now = new Date(),
  seed = randomInt(1, 2 ** 31),
) {
  if (!(kind in KIND_STEP)) throw new CourseError('experiment_step_not_allowed');
  const id = await db.transaction(async (tx) => {
    // The lock makes a double click start one test, not two; it comes before the step check reads the state.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'experiment:' + participant(user).id}))`,
    );
    const { actor, view } = await requireStep(tx, user, module, KIND_STEP[kind], now);
    if (view.runningAssessmentId) return view.runningAssessmentId;

    const pool = await tx
      .select({ id: questions.id })
      .from(questions)
      .innerJoin(nodes, eq(nodes.id, questions.nodeId))
      .where(
        and(
          eq(nodes.courseVersionId, view.versionId),
          eq(questions.pool, 'assessment'),
          eq(questions.status, 'validated'),
        ),
      )
      .orderBy(asc(questions.id));
    if (pool.length === 0) {
      throw new CourseError('test_unavailable', [
        {
          code: 'pool_too_small',
          message: 'The assessment pool of this module has no validated questions.',
        },
      ]);
    }
    const ids = shuffle(
      pool.map((q) => q.id),
      mulberry32(seed),
    );
    await assertQuestionsInPool(tx, ids, 'assessment');
    const [created] = await tx
      .insert(assessments)
      .values({
        userId: actor.id,
        kind,
        courseVersionId: view.versionId,
        startedAt: now,
        questionSetSeed: seed,
        meta: { module: view.module, condition: view.condition },
      })
      .returning({ id: assessments.id });
    await tx.insert(assessmentItems).values(
      ids.map((questionId, ord) => ({
        assessmentId: created!.id,
        questionId,
        ord,
        shownAt: now,
      })),
    );
    if (kind === 'pretest') {
      await logEvent(tx, actor.id, 'module_started', { versionId: view.versionId }, view.versionId);
    }
    await logEvent(
      tx,
      actor.id,
      `${kind}_started`,
      { assessmentId: created!.id, questions: ids.length },
      view.versionId,
    );
    return created!.id;
  });
  return getAssessment(db, user, id, learning, now);
}

/**
 * Grades one answer of a study test and writes it (`assessment_items`, `question_answered`). Unlike a node test it
 * gives no feedback and never touches BKT or node progress: the tests measure, they do not teach. The last
 * answer submits the test.
 */
async function answerStudyItem(
  db: Db,
  llm: LLMClient,
  user: AuthUser | null,
  a: Assessment,
  itemId: string,
  answer: unknown,
  learning: LearningSettings,
  now: Date,
) {
  const actor = participant(user);
  if (a.status !== 'in_progress') throw new CourseError('assessment_closed');
  const [row] = z.uuid().safeParse(itemId).success
    ? await db
        .select({ item: assessmentItems, question: questions })
        .from(assessmentItems)
        .innerJoin(questions, eq(questions.id, assessmentItems.questionId))
        .where(and(eq(assessmentItems.id, itemId), eq(assessmentItems.assessmentId, a.id)))
    : [];
  if (!row) throw new CourseError('assessment_not_found');
  if (row.item.answeredAt) throw new CourseError('already_answered');

  const grade = await gradeAnswer(
    { llm, openPassThreshold: learning.openPassThreshold },
    row.question,
    answer,
  );

  const finished = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: assessments.status })
      .from(assessments)
      .where(eq(assessments.id, a.id))
      .for('update');
    if (locked?.status !== 'in_progress') throw new CourseError('assessment_closed');
    const [prev] = await tx
      .select({ at: sql<Date | null>`max(${assessmentItems.answeredAt})` })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, a.id));
    const since = prev?.at ? new Date(prev.at) : a.startedAt;
    const [saved] = await tx
      .update(assessmentItems)
      .set({
        answer: answer as object,
        answeredAt: now,
        isCorrect: grade.isCorrect,
        score: grade.score,
        gradedBy: grade.gradedBy,
        graderRunId: grade.graderRunId ?? null,
        timeMs: Math.max(0, now.getTime() - since.getTime()),
      })
      .where(and(eq(assessmentItems.id, itemId), isNull(assessmentItems.answeredAt)))
      .returning({ id: assessmentItems.id });
    if (!saved) throw new CourseError('already_answered');
    await logEvent(
      tx,
      actor.id,
      'question_answered',
      {
        assessmentId: a.id,
        kind: a.kind,
        questionId: row.question.id,
        skillId: row.question.skillId,
        isCorrect: grade.isCorrect,
      },
      a.courseVersionId,
    );
    const items = await tx
      .select({ isCorrect: assessmentItems.isCorrect, answeredAt: assessmentItems.answeredAt })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, a.id));
    if (items.some((i) => !i.answeredAt)) return false;
    // The score is the share of correct answers (RESEARCH.md §3).
    const scorePct = (items.filter((i) => i.isCorrect).length / items.length) * 100;
    await tx
      .update(assessments)
      .set({ status: 'submitted', submittedAt: now, scorePct })
      .where(eq(assessments.id, a.id));
    await logEvent(
      tx,
      actor.id,
      `${a.kind}_submitted`,
      { assessmentId: a.id, scorePct, questions: items.length },
      a.courseVersionId,
    );
    return true;
  });
  return { finished, assessment: await getAssessment(db, actor, a.id, learning, now) };
}

/** One entry point for `POST /api/assessments/:id/items/:itemId/answer`: node tests and study tests. */
export async function answerAssessment(
  db: Db,
  llm: LLMClient,
  user: AuthUser | null,
  assessmentId: string,
  itemId: string,
  answer: unknown,
  learning: LearningSettings,
  now = new Date(),
) {
  const a = await loadOwnAssessment(db, participant(user), assessmentId);
  if (a.kind === 'node_test') {
    return answerItem(db, llm, user, assessmentId, itemId, answer, learning, now);
  }
  if (a.kind === 'exam') throw new CourseError('assessment_not_found'); // the exam has its own routes
  return answerStudyItem(db, llm, user, a, itemId, answer, learning, now);
}

// ---------------------------------------------------------------- learning finished, survey

/**
 * Control condition: the participant says they are done with the material (free navigation has no gate that
 * would end the module). In the method condition the module ends when every node is passed, never by a click.
 */
export async function finishLearning(
  db: Db,
  user: AuthUser | null,
  module: string,
  now = new Date(),
) {
  const { actor, view } = await requireStep(db, user, module, 'learning', now);
  if (view.condition !== 'control') throw new CourseError('experiment_step_not_allowed');
  const done = await db.transaction(async (tx) => {
    const updated = await tx
      .update(enrollments)
      .set({ status: 'completed', completedAt: now })
      .where(
        and(
          eq(enrollments.userId, actor.id),
          eq(enrollments.courseVersionId, view.versionId),
          eq(enrollments.status, 'active'),
        ),
      )
      .returning({ id: enrollments.id });
    if (updated.length === 0) throw new CourseError('not_enrolled');
    await logEvent(tx, actor.id, 'module_finished', { versionId: view.versionId }, view.versionId);
    return true;
  });
  return done;
}

const surveyInput = z.object({
  answers: z.object(
    Object.fromEntries(
      SURVEY_ITEMS.map((i) => [i.key, z.number().int().min(LIKERT_MIN).max(LIKERT_MAX)]),
    ),
  ),
});

/** The Likert questionnaire after a module (RESEARCH.md §2): all items, once. Stored as `survey_submitted`. */
export async function submitSurvey(
  db: Db,
  user: AuthUser | null,
  module: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = surveyInput.safeParse(input);
  if (!parsed.success) throw new CourseError('invalid_survey');
  return db.transaction(async (tx) => {
    const actor = participant(user);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'experiment:' + actor.id}))`);
    const { view } = await requireStep(tx, actor, module, 'survey', now);
    await logEvent(
      tx,
      actor.id,
      'survey_submitted',
      { answers: parsed.data.answers },
      view.versionId,
    );
    return true;
  });
}
