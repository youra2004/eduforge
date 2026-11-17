import { randomInt } from 'node:crypto';
import {
  assessmentItems,
  assessments,
  courseVersions,
  enrollments,
  masteryHistory,
  nodeEdges,
  nodeProgress,
  nodes,
  nodeSkills,
  questions,
  skillMastery,
  skills,
  type Assessment,
  type Db,
  type NodeSkillResult,
  type NodeState,
} from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { loadConfig } from '../config';
import { CourseError } from '../courses/errors';
import { loadVersion, type Tx } from '../courses/service';
import { toStudentQuestion } from '../questions/dto';
import { gradeAnswer } from '../questions/grading';
import { assertQuestionsInPool } from '../questions/service';
import { nodeCooldownSeconds } from '../time';
import { experimentContext, moduleOfVersion } from '../experiment/context';
import { assembleNodeTest } from './assemble';
import { assertNodeAccess, currentProgress, findProgress, loadNodeContext } from './access';
import { bktUpdate, passesNode } from './bkt';
import { logEvent, logModuleFinished } from './events';
import { afterNodeTest, refreshCooldown } from './state';

export interface LearningSettings {
  passThreshold: number;
  questionsPerSkill: number;
  attemptsPerRound: number;
  /** Already scaled by TIME_SCALE. */
  cooldownSeconds: number;
  openPassThreshold: number;
  bkt: { pInit: number; learn: number };
}

/** The engine's settings from env config, with the pause already scaled for demo mode (P2, D-32). */
export function learningSettings(config = loadConfig()): LearningSettings {
  return {
    passThreshold: config.node.passThreshold,
    questionsPerSkill: config.node.questionsPerSkill,
    attemptsPerRound: config.node.attemptsPerRound,
    cooldownSeconds: nodeCooldownSeconds(config),
    openPassThreshold: config.questions.openPassThreshold,
    bkt: { pInit: config.bkt.pInit, learn: config.bkt.learn },
  };
}

const student = (user: AuthUser | null) =>
  requireRole(user, 'student', 'author', 'expert', 'admin');

// ---------------------------------------------------------------- enrollment and node states

/** True once the user has a submitted assessment of this kind for the version (experiment tests, M07). */
async function hasSubmitted(
  db: Db | Tx,
  userId: string,
  versionId: string,
  kind: Assessment['kind'],
) {
  const [row] = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(
      and(
        eq(assessments.userId, userId),
        eq(assessments.courseVersionId, versionId),
        eq(assessments.kind, kind),
        eq(assessments.status, 'submitted'),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Enrolls the user in a published version and creates a progress row per node: roots are `available`,
 * everything else `locked` (F5-R5). Enrolling twice changes nothing. The version stays theirs for good (D-06).
 */
export async function enroll(db: Db, user: AuthUser | null, versionId: string) {
  const { version, user: actor } = await loadVersion(db, student(user), versionId);
  if (version.status !== 'published') throw new CourseError('version_not_published');
  // Study modules (M07): learning starts after the pre-test, and the control condition has no gating (D-30).
  const study = await experimentContext(db, actor.id, versionId);
  if (!study && (await moduleOfVersion(db, versionId)))
    throw new CourseError('experiment_not_joined');
  if (study && !(await hasSubmitted(db, actor.id, versionId, 'pretest'))) {
    throw new CourseError('experiment_step_not_allowed');
  }
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(enrollments)
      .values({ userId: actor.id, courseVersionId: versionId })
      .onConflictDoNothing()
      .returning();
    if (!created) return;
    const nodeRows = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.courseVersionId, versionId));
    const ids = nodeRows.map((n) => n.id);
    const hasPrereq = new Set(
      ids.length
        ? (await tx.select().from(nodeEdges).where(inArray(nodeEdges.nodeId, ids))).map(
            (e) => e.nodeId,
          )
        : [],
    );
    if (ids.length) {
      await tx.insert(nodeProgress).values(
        ids.map((id) => ({
          userId: actor.id,
          nodeId: id,
          state: (hasPrereq.has(id) && study?.condition !== 'control'
            ? 'locked'
            : 'available') as NodeState,
        })),
      );
    }
    await logEvent(tx, actor.id, 'enrolled', { versionId, nodes: ids.length }, versionId);
  });
}

export interface NodeProgressView {
  nodeId: string;
  state: NodeState;
  roundNo: number;
  attemptsInRound: number;
  cooldownUntil: Date | null;
  passedAt: Date | null;
}

/** The user's node states in a version, or `null` while not enrolled. A finished pause already reads `available`. */
export async function getProgress(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  now = new Date(),
): Promise<NodeProgressView[] | null> {
  const { user: actor } = await loadVersion(db, student(user), versionId);
  const [enrolled] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, actor.id), eq(enrollments.courseVersionId, versionId)));
  if (!enrolled) return null;
  const rows = await db
    .select({ progress: nodeProgress })
    .from(nodeProgress)
    .innerJoin(nodes, eq(nodes.id, nodeProgress.nodeId))
    .where(and(eq(nodeProgress.userId, actor.id), eq(nodes.courseVersionId, versionId)));
  return rows.map(({ progress: p }) => {
    const { state, roundNo, attemptsInRound, cooldownUntil } = refreshCooldown(p, now);
    return {
      nodeId: p.nodeId,
      state,
      roundNo,
      attemptsInRound,
      cooldownUntil,
      passedAt: p.passedAt,
    };
  });
}

/** The user's courses with how many nodes are passed, for the student page. */
export async function listEnrollments(db: Db, user: AuthUser | null) {
  const actor = student(user);
  return db
    .select({
      versionId: courseVersions.id,
      title: courseVersions.title,
      versionNo: courseVersions.versionNo,
      status: enrollments.status,
      nodesTotal: sql<number>`(SELECT count(*)::int FROM ${nodes} WHERE ${nodes.courseVersionId} = ${courseVersions.id})`,
      nodesPassed: sql<number>`(SELECT count(*)::int FROM ${nodeProgress} JOIN ${nodes} ON ${nodes.id} = ${nodeProgress.nodeId} WHERE ${nodes.courseVersionId} = ${courseVersions.id} AND ${nodeProgress.userId} = ${actor.id} AND ${nodeProgress.state} = 'passed')`,
    })
    .from(enrollments)
    .innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId))
    .where(eq(enrollments.userId, actor.id))
    .orderBy(asc(courseVersions.title));
}

// ---------------------------------------------------------------- node test

type Rng = () => number;

/** Starts a node test, or returns the one already running. The server checks access, the pause and the pool (P1). */
export async function startNodeTest(
  db: Db,
  user: AuthUser | null,
  nodeId: string,
  settings: LearningSettings,
  now = new Date(),
  seed = randomInt(1, 2 ** 31),
) {
  const { version, user: actor } = await loadNodeContext(db, student(user), nodeId);
  // The control condition has no node tests and so no gating (D-30); the server refuses, whatever the client shows.
  if ((await experimentContext(db, actor.id, version.id))?.condition === 'control') {
    throw new CourseError('node_test_disabled');
  }
  const id = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(nodeProgress)
      .where(and(eq(nodeProgress.userId, actor.id), eq(nodeProgress.nodeId, nodeId)))
      .for('update');
    if (!locked) throw new CourseError('not_enrolled');
    const p = refreshCooldown(locked, now);
    if (p.state === 'locked') throw new CourseError('node_locked');
    if (p.state === 'cooldown') throw new CourseError('node_cooldown');
    if (p.state === 'passed') throw new CourseError('node_passed');

    const [running] = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(
        and(
          eq(assessments.userId, actor.id),
          eq(assessments.nodeId, nodeId),
          eq(assessments.kind, 'node_test'),
          eq(assessments.status, 'in_progress'),
        ),
      );
    if (running) return running.id;

    const skillRows = await tx
      .select({ id: nodeSkills.skillId })
      .from(nodeSkills)
      .where(eq(nodeSkills.nodeId, nodeId))
      .orderBy(asc(nodeSkills.skillId));
    const pool = await tx
      .select({ id: questions.id, skillId: questions.skillId })
      .from(questions)
      .where(
        and(
          eq(questions.nodeId, nodeId),
          eq(questions.pool, 'node'),
          eq(questions.status, 'validated'),
        ),
      )
      .orderBy(asc(questions.id));
    const seenRows = await tx
      .select({ id: assessmentItems.questionId })
      .from(assessmentItems)
      .innerJoin(assessments, eq(assessments.id, assessmentItems.assessmentId))
      .where(
        and(
          eq(assessments.userId, actor.id),
          eq(assessments.nodeId, nodeId),
          eq(assessments.kind, 'node_test'),
        ),
      );
    const assembly = assembleNodeTest({
      skills: skillRows.map((s) => ({
        skillId: s.id,
        questionIds: pool.filter((q) => q.skillId === s.id).map((q) => q.id),
      })),
      seen: new Set(seenRows.map((r) => r.id)),
      perSkill: settings.questionsPerSkill,
      seed,
    });
    if (!assembly.ok) {
      throw new CourseError('test_unavailable', [
        {
          code: 'pool_too_small',
          message: `Not enough validated node-pool questions for skills: ${assembly.shortSkillIds.join(', ')}.`,
        },
      ]);
    }
    // D-17: whatever the query above did, an exam question must never reach a node test.
    await assertQuestionsInPool(tx, assembly.questionIds, 'node');

    const [created] = await tx
      .insert(assessments)
      .values({
        userId: actor.id,
        kind: 'node_test',
        courseVersionId: version.id,
        nodeId,
        roundNo: p.roundNo,
        attemptNo: p.attemptsInRound + 1,
        startedAt: now,
        questionSetSeed: seed,
      })
      .returning({ id: assessments.id });
    await tx.insert(assessmentItems).values(
      assembly.questionIds.map((questionId, ord) => ({
        assessmentId: created!.id,
        questionId,
        ord,
        shownAt: now,
      })),
    );
    await tx
      .update(nodeProgress)
      .set({
        state: 'in_progress',
        roundNo: p.roundNo,
        attemptsInRound: p.attemptsInRound,
        cooldownUntil: null,
      })
      .where(and(eq(nodeProgress.userId, actor.id), eq(nodeProgress.nodeId, nodeId)));
    await logEvent(
      tx,
      actor.id,
      'node_test_started',
      {
        nodeId,
        assessmentId: created!.id,
        roundNo: p.roundNo,
        attemptNo: p.attemptsInRound + 1,
        questions: assembly.questionIds.length,
      },
      version.id,
    );
    return created!.id;
  });
  return getAssessment(db, actor, id, settings, now);
}

export async function loadOwnAssessment(db: Db | Tx, user: AuthUser, assessmentId: string) {
  const [row] = z.uuid().safeParse(assessmentId).success
    ? await db.select().from(assessments).where(eq(assessments.id, assessmentId))
    : [];
  if (!row || row.userId !== user.id) throw new CourseError('assessment_not_found');
  return row;
}

/**
 * The student's view of a test. While it runs there are no verdicts and no keys; once finished it carries
 * the result: pass/fail, per-skill mastery and which answers were right, and what happens to the node next.
 */
export async function getAssessment(
  db: Db,
  user: AuthUser | null,
  assessmentId: string,
  settings: LearningSettings,
  now = new Date(),
) {
  const actor = student(user);
  const a = await loadOwnAssessment(db, actor, assessmentId);
  // The exam shows one question at a time and has its own view (M09); this one would list them all.
  if (a.kind === 'exam') throw new CourseError('assessment_not_found');
  const items = await db
    .select({ item: assessmentItems, question: questions })
    .from(assessmentItems)
    .innerJoin(questions, eq(questions.id, assessmentItems.questionId))
    .where(eq(assessmentItems.assessmentId, a.id))
    .orderBy(asc(assessmentItems.ord));
  const finished = a.status !== 'in_progress';
  const progress = a.nodeId ? await findProgress(db, actor.id, a.nodeId) : undefined;
  const view = progress ? currentProgress(progress, now) : undefined;
  // Study tests (M07) give no feedback at all: no verdicts and no result, only "submitted".
  const feedback = a.kind === 'node_test';
  return {
    id: a.id,
    kind: a.kind,
    nodeId: a.nodeId,
    versionId: a.courseVersionId,
    status: a.status,
    roundNo: a.roundNo,
    attemptNo: a.attemptNo,
    attemptsPerRound: settings.attemptsPerRound,
    items: items.map(({ item, question }) => ({
      id: item.id,
      ord: item.ord,
      answered: item.answeredAt !== null,
      // Verdicts only after the test is over (F5-R3 retries draw new questions, but keep the test honest).
      isCorrect: finished && feedback ? item.isCorrect : null,
      question: toStudentQuestion(question),
    })),
    result:
      finished && feedback
        ? {
            passed: a.status === 'passed',
            scorePct: a.scorePct,
            perSkill: (a.perSkill ?? []) as NodeSkillResult[],
            threshold: settings.passThreshold,
            node: view && {
              state: view.state,
              attemptsInRound: view.attemptsInRound,
              cooldownUntil: view.cooldownUntil,
            },
          }
        : null,
  };
}

/**
 * Grades one answer on the server, applies BKT for its skill, and writes `assessment_items` and `mastery_history`
 * (F5-R7). The last answer finishes the test: pass rule, node state, unlocking, pause (F5-R3..R5).
 */
export async function answerItem(
  db: Db,
  llm: LLMClient,
  user: AuthUser | null,
  assessmentId: string,
  itemId: string,
  answer: unknown,
  settings: LearningSettings,
  now = new Date(),
) {
  const actor = student(user);
  const a = await loadOwnAssessment(db, actor, assessmentId);
  if (a.kind !== 'node_test') throw new CourseError('assessment_not_found'); // study tests: `answerAssessment`
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

  // The LLM call (short/open) stays outside the transaction; the write below re-checks the item is still open.
  const grade = await gradeAnswer(
    { llm, openPassThreshold: settings.openPassThreshold },
    row.question,
    answer,
  );

  const finished = await db.transaction(async (tx) => {
    // Serialises answers of one test, so the "last answer" is decided exactly once.
    const [locked] = await tx
      .select({ status: assessments.status })
      .from(assessments)
      .where(eq(assessments.id, a.id))
      .for('update');
    if (locked?.status !== 'in_progress') throw new CourseError('assessment_closed');

    const [previous] = await tx
      .select({ at: sql<Date | null>`max(${assessmentItems.answeredAt})` })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, a.id));
    const since = previous?.at ? new Date(previous.at) : a.startedAt;
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

    // BKT for the question's skill. The row is created at p_init, then locked while it is updated.
    await tx
      .insert(skillMastery)
      .values({ userId: actor.id, skillId: row.question.skillId, pKnown: settings.bkt.pInit })
      .onConflictDoNothing();
    const [mastery] = await tx
      .select()
      .from(skillMastery)
      .where(and(eq(skillMastery.userId, actor.id), eq(skillMastery.skillId, row.question.skillId)))
      .for('update');
    const pAfter = bktUpdate({
      p: mastery!.pKnown,
      correct: grade.isCorrect,
      guess: row.question.guess,
      slip: row.question.slip,
      learn: settings.bkt.learn,
    });
    await tx
      .update(skillMastery)
      .set({ pKnown: pAfter, nObs: mastery!.nObs + 1, updatedAt: now })
      .where(
        and(eq(skillMastery.userId, actor.id), eq(skillMastery.skillId, row.question.skillId)),
      );
    await tx.insert(masteryHistory).values({
      userId: actor.id,
      skillId: row.question.skillId,
      assessmentItemId: itemId,
      pBefore: mastery!.pKnown,
      pAfter,
      at: now,
    });
    await logEvent(
      tx,
      actor.id,
      'question_answered',
      {
        assessmentId: a.id,
        questionId: row.question.id,
        skillId: row.question.skillId,
        isCorrect: grade.isCorrect,
        score: grade.score,
        pBefore: mastery!.pKnown,
        pAfter,
      },
      a.courseVersionId,
    );
    await logEvent(
      tx,
      actor.id,
      'mastery_updated',
      { skillId: row.question.skillId, pAfter },
      a.courseVersionId,
    );

    const [{ open }] = (await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(assessmentItems)
      .where(and(eq(assessmentItems.assessmentId, a.id), isNull(assessmentItems.answeredAt)))) as [
      { open: number },
    ];
    if (open > 0) return false;
    await finishNodeTest(tx, a, settings, now);
    return true;
  });

  return { finished, assessment: await getAssessment(db, actor, a.id, settings, now) };
}

/** After the last answer: pass rule over the node's skills, node state, unlocking, completion (D-11). */
async function finishNodeTest(tx: Tx, a: Assessment, settings: LearningSettings, now: Date) {
  const nodeId = a.nodeId!;
  // Two tests of one student finishing together must not both miss each other's pass when they check
  // the prerequisites of a shared dependent (READ COMMITTED): the enrollment row is the one lock they queue on.
  await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, a.userId), eq(enrollments.courseVersionId, a.courseVersionId)),
    )
    .for('update');
  const nodeSkillRows = await tx
    .select({ id: skills.id, name: skills.name })
    .from(nodeSkills)
    .innerJoin(skills, eq(skills.id, nodeSkills.skillId))
    .where(eq(nodeSkills.nodeId, nodeId))
    .orderBy(asc(skills.name));
  const masteryRows = await tx
    .select()
    .from(skillMastery)
    .where(
      and(
        eq(skillMastery.userId, a.userId),
        inArray(
          skillMastery.skillId,
          nodeSkillRows.map((s) => s.id),
        ),
      ),
    );
  const perSkill = nodeSkillRows.map((s) => ({
    skillId: s.id,
    name: s.name,
    pKnown: masteryRows.find((m) => m.skillId === s.id)?.pKnown ?? settings.bkt.pInit,
  }));
  const passed = passesNode(
    perSkill.map((s) => s.pKnown),
    settings.passThreshold,
  );
  const scores = await tx
    .select({ score: assessmentItems.score })
    .from(assessmentItems)
    .where(eq(assessmentItems.assessmentId, a.id));
  const scorePct = (scores.reduce((sum, r) => sum + (r.score ?? 0), 0) / scores.length) * 100;

  await tx
    .update(assessments)
    .set({ status: passed ? 'passed' : 'failed', submittedAt: now, scorePct, perSkill })
    .where(eq(assessments.id, a.id));

  const [locked] = await tx
    .select()
    .from(nodeProgress)
    .where(and(eq(nodeProgress.userId, a.userId), eq(nodeProgress.nodeId, nodeId)))
    .for('update');
  const next = afterNodeTest(locked!, passed, settings, now);
  await tx
    .update(nodeProgress)
    .set({
      state: next.state,
      attemptsInRound: next.attemptsInRound,
      cooldownUntil: next.cooldownUntil,
      passedAt: passed ? now : null,
    })
    .where(and(eq(nodeProgress.userId, a.userId), eq(nodeProgress.nodeId, nodeId)));
  await logEvent(
    tx,
    a.userId,
    'node_test_submitted',
    {
      nodeId,
      assessmentId: a.id,
      passed,
      scorePct,
      roundNo: a.roundNo,
      attemptNo: a.attemptNo,
      perSkill: perSkill.map((s) => ({ skillId: s.skillId, pKnown: s.pKnown })),
    },
    a.courseVersionId,
  );
  if (next.state === 'cooldown') {
    await logEvent(
      tx,
      a.userId,
      'cooldown_started',
      { nodeId, until: next.cooldownUntil?.toISOString() },
      a.courseVersionId,
    );
  }
  if (passed) await unlockDependents(tx, a.userId, a.courseVersionId, nodeId, now);
}

/** F5-R5 / D-12: a node opens when *all* its prerequisites are passed. */
async function unlockDependents(
  tx: Tx,
  userId: string,
  versionId: string,
  passedNodeId: string,
  now: Date,
) {
  const dependents = await tx
    .select({ id: nodeEdges.nodeId })
    .from(nodeEdges)
    .where(eq(nodeEdges.prereqNodeId, passedNodeId));
  for (const { id } of dependents) {
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(nodeEdges)
      .leftJoin(
        nodeProgress,
        and(eq(nodeProgress.nodeId, nodeEdges.prereqNodeId), eq(nodeProgress.userId, userId)),
      )
      .where(and(eq(nodeEdges.nodeId, id), sql`${nodeProgress.state} IS DISTINCT FROM 'passed'`));
    if (open!.n > 0) continue;
    const unlocked = await tx
      .update(nodeProgress)
      .set({ state: 'available' })
      .where(
        and(
          eq(nodeProgress.userId, userId),
          eq(nodeProgress.nodeId, id),
          eq(nodeProgress.state, 'locked'),
        ),
      )
      .returning({ id: nodeProgress.nodeId });
    if (unlocked.length > 0)
      await logEvent(tx, userId, 'node_unlocked', { nodeId: id, by: passedNodeId }, versionId);
  }
  const [rest] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(nodeProgress)
    .innerJoin(nodes, eq(nodes.id, nodeProgress.nodeId))
    .where(
      and(
        eq(nodeProgress.userId, userId),
        eq(nodes.courseVersionId, versionId),
        sql`${nodeProgress.state} <> 'passed'`,
      ),
    );
  if (rest!.n === 0) {
    await tx
      .update(enrollments)
      .set({ status: 'completed', completedAt: now })
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseVersionId, versionId)));
    await logEvent(tx, userId, 'course_completed', { versionId }, versionId);
    await logModuleFinished(tx, userId, versionId);
  }
}

// ---------------------------------------------------------------- practice

/** Questions of the student's running node tests: practice must not tell them whether an answer is right. */
const inRunningTest = (userId: string) =>
  sql`(SELECT ${assessmentItems.questionId} FROM ${assessmentItems} JOIN ${assessments} ON ${assessments.id} = ${assessmentItems.assessmentId} WHERE ${assessments.userId} = ${userId} AND ${assessments.status} = 'in_progress')`;

/**
 * F5-R6: a free question from the node's pool. Same gate as the node itself; asking changes nothing.
 * The node test draws from the same pool, so practice shows whether an answer was right, never the key.
 */
export async function getPracticeQuestion(
  db: Db,
  user: AuthUser | null,
  nodeId: string,
  exclude: string[] = [],
  rng: Rng = Math.random,
) {
  const { actor } = await assertNodeAccess(db, student(user), nodeId);
  const skip = exclude.filter((id) => z.uuid().safeParse(id).success);
  const rows = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.nodeId, nodeId),
        eq(questions.pool, 'node'),
        eq(questions.status, 'validated'),
        skip.length ? notInArray(questions.id, skip) : undefined,
        sql`${questions.id} NOT IN ${inRunningTest(actor.id)}`,
      ),
    );
  const q = rows[Math.floor(rng() * rows.length)];
  return q ? toStudentQuestion(q) : null;
}

/** Grades a practice answer. It writes an event for the research log and nothing else: no BKT, no progress. */
export async function answerPractice(
  db: Db,
  llm: LLMClient,
  user: AuthUser | null,
  nodeId: string,
  questionId: string,
  answer: unknown,
  settings: LearningSettings,
) {
  const { actor, version } = await assertNodeAccess(db, student(user), nodeId);
  const [q] = z.uuid().safeParse(questionId).success
    ? await db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.id, questionId),
            eq(questions.nodeId, nodeId),
            eq(questions.pool, 'node'),
            eq(questions.status, 'validated'),
            sql`${questions.id} NOT IN ${inRunningTest(actor.id)}`,
          ),
        )
    : [];
  if (!q) throw new CourseError('question_not_found');
  const grade = await gradeAnswer(
    { llm, openPassThreshold: settings.openPassThreshold },
    q,
    answer,
  );
  await logEvent(
    db,
    actor.id,
    'practice_answered',
    { nodeId, questionId, skillId: q.skillId, isCorrect: grade.isCorrect },
    version.id,
  );
  return { isCorrect: grade.isCorrect, score: grade.score };
}
