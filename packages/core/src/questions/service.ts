import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  courseVersions,
  nodes,
  nodeSkills,
  questionPools,
  questions,
  skills,
  type Db,
  type Question,
  type QuestionPool,
} from '@eduforge/db';
import { z } from 'zod';
import { AuthError, hasRole, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { canEdit, EDITABLE_STATUSES, loadVersion, type Tx } from '../courses/service';
import { toAuthorQuestion } from './dto';
import { questionBody, toColumns, type QuestionBody } from './schema';

const createInput = z.intersection(z.object({ pool: z.enum(questionPools) }), questionBody);

const decisionInput = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('reject'), reason: z.string().trim().min(1).max(500).optional() }),
]);

const invalid = (message: string, path?: string) =>
  new CourseError('invalid_question', [{ code: 'schema', message, path }]);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new CourseError(
    'invalid_question',
    parsed.error.issues.map((i) => ({
      code: 'schema' as const,
      message: i.message,
      path: i.path.join('.'),
    })),
  );
}

async function loadNode(db: Db, user: AuthUser | null, nodeId: string) {
  const [row] = z.uuid().safeParse(nodeId).success
    ? await db.select({ versionId: nodes.courseVersionId }).from(nodes).where(eq(nodes.id, nodeId))
    : [];
  if (!row) throw new CourseError('course_not_found');
  return { nodeId, ...(await loadVersion(db, user, row.versionId)) };
}

/** Questions carry answer keys: only the course's author, admins and experts may read them (P6). */
const canRead = (user: AuthUser, authorId: string) =>
  canEdit(user, authorId) || hasRole(user, 'admin', 'expert');

async function loadQuestion(db: Db, user: AuthUser | null, questionId: string) {
  const [q] = z.uuid().safeParse(questionId).success
    ? await db.select().from(questions).where(eq(questions.id, questionId))
    : [];
  if (!q) throw new CourseError('question_not_found');
  const ctx = await loadNode(db, user, q.nodeId).catch((err) => {
    throw err instanceof CourseError ? new CourseError('question_not_found') : err;
  });
  if (!canRead(ctx.user, ctx.course.authorId)) throw new CourseError('question_not_found');
  return { question: q, ...ctx };
}

/** The questions of a node for its author (or an admin/expert), and the validated count per skill and pool. */
export async function listNodeQuestions(db: Db, user: AuthUser | null, nodeId: string) {
  const { version, course, user: actor } = await loadNode(db, user, nodeId);
  if (!canRead(actor, course.authorId)) throw new AuthError('forbidden');
  const rows = await db
    .select()
    .from(questions)
    .where(eq(questions.nodeId, nodeId))
    .orderBy(asc(questions.pool), asc(questions.createdAt), asc(questions.id));
  const skillRows = await db
    .select({ id: skills.id, name: skills.name })
    .from(nodeSkills)
    .innerJoin(skills, eq(skills.id, nodeSkills.skillId))
    .where(eq(nodeSkills.nodeId, nodeId))
    .orderBy(asc(skills.name));
  return {
    questions: rows.map(toAuthorQuestion),
    skills: skillRows,
    canEdit: canEdit(actor, course.authorId) && EDITABLE_STATUSES.includes(version.status),
  };
}

/** Runs `write` with the version row share-locked after checking the caller may edit it (D-06). */
async function editVersionOf<T>(
  db: Db,
  versionId: string,
  write: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: courseVersions.status })
      .from(courseVersions)
      .where(eq(courseVersions.id, versionId))
      .for('share');
    if (!locked || !EDITABLE_STATUSES.includes(locked.status)) {
      throw new CourseError('version_locked');
    }
    return write(tx);
  });
}

async function assertSkillOfNode(tx: Db | Tx, nodeId: string, skillId: string) {
  const [link] = await tx
    .select({ skillId: nodeSkills.skillId })
    .from(nodeSkills)
    .where(and(eq(nodeSkills.nodeId, nodeId), eq(nodeSkills.skillId, skillId)));
  if (!link) throw invalid('The skill does not belong to this node.', 'skillId');
}

function columnsOf(body: QuestionBody) {
  const cols = toColumns(body);
  if (!cols.ok) throw invalid(cols.message);
  return cols.value;
}

/** F3-R4: the author adds a question by hand. It starts as `generated` and goes through the same validator. */
export async function createQuestion(
  db: Db,
  user: AuthUser | null,
  nodeId: string,
  input: unknown,
  cfg: { slip: number },
) {
  const data = parse(createInput, input);
  const { version, course, user: actor } = await loadNode(db, user, nodeId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  const cols = columnsOf(data);
  return editVersionOf(db, version.id, async (tx) => {
    await assertSkillOfNode(tx, nodeId, data.skillId);
    const [row] = await tx
      .insert(questions)
      .values({
        ...cols,
        nodeId,
        skillId: data.skillId,
        pool: data.pool,
        slip: cfg.slip,
        createdBy: actor.id,
      })
      .returning();
    return toAuthorQuestion(row!);
  });
}

/**
 * Edits a question (same kind, same pool). The old verdict no longer applies, so it goes back to `generated`
 * and must be validated again (F3-R4); `revision` makes a validation already running for the old text a no-op.
 */
export async function updateQuestion(
  db: Db,
  user: AuthUser | null,
  questionId: string,
  input: unknown,
) {
  const { question: seen, version, course, user: actor } = await loadQuestion(db, user, questionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  const body = parse(questionBody, input);
  if (body.kind !== seen.kind) throw invalid('The type of a question cannot change.', 'kind');
  const cols = columnsOf(body);
  return editVersionOf(db, version.id, async (tx) => {
    const [q] = await tx.select().from(questions).where(eq(questions.id, questionId)).for('update');
    if (!q) throw new CourseError('question_not_found');
    if (q.status === 'retired') throw invalid('A retired question cannot be edited.');
    await assertSkillOfNode(tx, q.nodeId, body.skillId);
    const [row] = await tx
      .update(questions)
      .set({
        ...cols,
        skillId: body.skillId,
        status: 'generated',
        rejectionReason: null,
        validatorRunId: null,
        difficulty: 0.5,
        revision: sql`${questions.revision} + 1`,
      })
      .where(eq(questions.id, questionId))
      .returning();
    return toAuthorQuestion(row!);
  });
}

/**
 * The author's call on a question: approve (it becomes `validated` whatever the validator said) or reject it.
 * A question that was validated can be rejected; one that was rejected or is still waiting can be approved.
 */
export async function decideQuestion(
  db: Db,
  user: AuthUser | null,
  questionId: string,
  input: unknown,
) {
  const { version, course, user: actor } = await loadQuestion(db, user, questionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  const d = parse(decisionInput, input);
  return editVersionOf(db, version.id, async (tx) => {
    const [q] = await tx.select().from(questions).where(eq(questions.id, questionId)).for('update');
    if (!q) throw new CourseError('question_not_found');
    const next = d.decision === 'approve' ? 'validated' : 'rejected';
    if (q.status === next || q.status === 'retired') {
      throw invalid(`The question is already ${q.status}.`);
    }
    const [row] = await tx
      .update(questions)
      .set({
        status: next,
        rejectionReason: d.decision === 'reject' ? (d.reason ?? 'Відхилено автором.') : null,
      })
      .where(eq(questions.id, questionId))
      .returning();
    return toAuthorQuestion(row!);
  });
}

/**
 * D-17: pools never overlap. Throws `wrong_pool` naming the questions if any of `ids` is not in `pool`, so
 * an `exam` question cannot end up in a node test (and vice versa). Unknown ids are `question_not_found`.
 */
export async function assertQuestionsInPool(db: Db | Tx, ids: string[], pool: QuestionPool) {
  if (ids.length === 0) return;
  const rows: Pick<Question, 'id' | 'pool'>[] = await db
    .select({ id: questions.id, pool: questions.pool })
    .from(questions)
    .where(inArray(questions.id, ids));
  if (rows.length !== new Set(ids).size) throw new CourseError('question_not_found');
  const wrong = rows.filter((r) => r.pool !== pool);
  if (wrong.length > 0) {
    throw new CourseError('wrong_pool', [
      {
        code: 'schema',
        message: `Questions not in the "${pool}" pool: ${wrong.map((r) => `${r.id} (${r.pool})`).join(', ')}.`,
      },
    ]);
  }
}

const generateInput = z
  .object({
    pool: z.enum(questionPools),
    perSkill: z.number().int().min(1).max(10).optional(),
  })
  .strict();

/**
 * Checks that the caller may generate questions for the node and works out the job to queue. Without `perSkill`
 * the generator writes one more than the pool minimum, since the validator may reject some.
 */
export async function planGeneration(
  db: Db,
  user: AuthUser | null,
  nodeId: string,
  input: unknown,
  mins: { nodeMinPerSkill: number; examMinPerSkill: number },
) {
  const data = parse(generateInput, input);
  const { version, course, user: actor } = await loadNode(db, user, nodeId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  if (!EDITABLE_STATUSES.includes(version.status)) throw new CourseError('version_locked');
  const min = data.pool === 'exam' ? mins.examMinPerSkill : mins.nodeMinPerSkill;
  return { nodeId, pool: data.pool, perSkill: data.perSkill ?? Math.min(10, min + 1) };
}
