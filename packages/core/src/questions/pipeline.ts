import { courseVersions, nodes, questions, skills, type Db, type QuestionPool } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { and, eq } from 'drizzle-orm';
import { CourseError } from '../courses/errors';
import { EDITABLE_STATUSES } from '../courses/service';
import {
  GENERATOR_SYSTEM,
  GENERATOR_VERSION,
  generatorPrompt,
  VALIDATOR_SYSTEM,
  VALIDATOR_VERSION,
  validatorPrompt,
} from './prompts';
import { generatorOutput, toColumns, validatorOutput } from './schema';
import { noTheory, nodeSkillList, nodeTheory, nodeVersionEditable } from './theory';

export interface PipelineConfig {
  /** The default `slip` of a new question (F3-R5). */
  slip: number;
}

/**
 * The generator (F3-R3): sees only the node's theory and its skills and writes `perSkill` questions for
 * each skill into `pool`. They are stored as `generated`; the validator decides what happens next.
 * Questions that point at a skill outside the node, or that contradict themselves, are dropped.
 */
export async function generateQuestions(
  db: Db,
  llm: LLMClient,
  cfg: PipelineConfig,
  input: { nodeId: string; pool: QuestionPool; perSkill: number },
) {
  const editable = await nodeVersionEditable(db, input.nodeId);
  if (editable === null) throw new CourseError('course_not_found');
  if (!editable) throw new CourseError('version_locked');
  const [theory, skillList] = await Promise.all([
    nodeTheory(db, input.nodeId),
    nodeSkillList(db, input.nodeId),
  ]);
  if (theory === '') throw noTheory();
  if (skillList.length === 0) {
    throw new CourseError('invalid_question', [
      { code: 'schema', message: 'The node has no skills to write questions for.' },
    ]);
  }

  const run = await llm.generate({
    purpose: 'question_generation',
    promptVersion: GENERATOR_VERSION,
    system: GENERATOR_SYSTEM,
    prompt: generatorPrompt(theory, skillList, input.perSkill),
    schema: generatorOutput,
    cache: false, // asking again must give new questions
    subject: { type: 'node', id: input.nodeId },
  });

  const known = new Set(skillList.map((s) => s.id));
  const rows = run.data.questions.flatMap((body) => {
    const cols = toColumns(body);
    if (!known.has(body.skillId) || !cols.ok) return [];
    return [{ ...cols.value, skillId: body.skillId }];
  });
  const inserted = rows.length
    ? await db
        .insert(questions)
        .values(
          rows.map((r) => ({
            ...r,
            nodeId: input.nodeId,
            pool: input.pool,
            slip: cfg.slip,
            generatorRunId: run.runId,
          })),
        )
        .returning({ id: questions.id })
    : [];
  return {
    runId: run.runId,
    questionIds: inserted.map((q) => q.id),
    dropped: run.data.questions.length - rows.length,
  };
}

export type ValidationResult =
  | { status: 'validated' | 'rejected'; runId: string }
  | { status: 'skipped'; reason: 'not_found' | 'not_pending' | 'version_locked' | 'edited' };

/**
 * The validator (F3-R3), a separate call: is the key right according to the theory, is the wording
 * unambiguous, does the question test its skill, how hard is it. Does nothing for a question that is no longer
 * waiting for validation or was edited while the call was running (a newer validation is queued for that).
 */
export async function validateQuestion(
  db: Db,
  llm: LLMClient,
  questionId: string,
): Promise<ValidationResult> {
  const [q] = await db.select().from(questions).where(eq(questions.id, questionId));
  if (!q) return { status: 'skipped', reason: 'not_found' };
  if (q.status !== 'generated') return { status: 'skipped', reason: 'not_pending' };
  if (!(await nodeVersionEditable(db, q.nodeId)))
    return { status: 'skipped', reason: 'version_locked' };

  const [skill] = await db.select().from(skills).where(eq(skills.id, q.skillId));
  const theory = await nodeTheory(db, q.nodeId);
  if (!skill || theory === '') throw noTheory();

  const run = await llm.generate({
    purpose: 'question_validation',
    promptVersion: VALIDATOR_VERSION,
    system: VALIDATOR_SYSTEM,
    prompt: validatorPrompt(theory, skill, q),
    schema: validatorOutput,
    cache: false,
    subject: { type: 'question', id: q.id },
  });

  const v = run.data;
  const failed = [
    !v.keyCorrect && 'the marked answer is wrong',
    !v.unambiguous && 'the wording is ambiguous',
    !v.matchesSkill && 'it does not test the skill',
  ].filter(Boolean);
  const status = failed.length === 0 ? ('validated' as const) : ('rejected' as const);

  const written = await db.transaction(async (tx) => {
    // Share-lock the version so a status change (submit for audit) cannot slip in between the check and the write.
    const [version] = await tx
      .select({ status: courseVersions.status })
      .from(nodes)
      .innerJoin(courseVersions, eq(courseVersions.id, nodes.courseVersionId))
      .where(eq(nodes.id, q.nodeId))
      .for('share');
    if (!version || !EDITABLE_STATUSES.includes(version.status)) return 'version_locked' as const;
    const rows = await tx
      .update(questions)
      .set({
        status,
        difficulty: v.difficulty,
        rejectionReason: status === 'rejected' ? `${failed.join('; ')}. ${v.reason}`.trim() : null,
        validatorRunId: run.runId,
      })
      // `revision` and `status` make the write conditional on the text being the one we judged.
      .where(
        and(
          eq(questions.id, q.id),
          eq(questions.status, 'generated'),
          eq(questions.revision, q.revision),
        ),
      )
      .returning({ id: questions.id });
    return rows.length > 0 ? ('written' as const) : ('edited' as const);
  });
  if (written !== 'written') return { status: 'skipped', reason: written };
  return { status, runId: run.runId };
}

/** `generated` questions that still wait for a verdict; the worker re-queues them when it starts. */
export async function findPendingQuestionIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.status, 'generated'));
  return rows.map((r) => r.id);
}
