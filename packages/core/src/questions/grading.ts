import type { Question } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { CourseError } from '../courses/errors';
import {
  openGraderPrompt,
  OPEN_GRADER_SYSTEM,
  OPEN_GRADER_VERSION,
  SHORT_GRADER_SYSTEM,
  SHORT_GRADER_VERSION,
  shortGraderPrompt,
} from './prompts';
import { answerKeys, openGrade, shortEquivalence, studentAnswer } from './schema';

export type GradableQuestion = Pick<
  Question,
  'id' | 'kind' | 'promptMd' | 'options' | 'answerKey' | 'rubric'
>;

export interface Grade {
  isCorrect: boolean;
  /** 0..1. mcq and short are 0 or 1; open is the LLM's score. */
  score: number;
  gradedBy: 'auto' | 'llm';
  graderRunId?: string;
}

export interface GradingDeps {
  llm: LLMClient;
  /** An open answer is correct from this score up (F3-R1). */
  openPassThreshold: number;
}

/**
 * Compares answers regardless of case, spacing, apostrophe style and sentence punctuation at the ends.
 * Symbols inside an answer stay (`-5`, `C++`, `50%` differ from `5`, `C`, `50`); what does not match goes to the LLM.
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’ʼ`´]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?"«»“”„]+|[\s.,;:!?"«»“”„]+$/g, '');
}

export function gradeMcq(q: Pick<GradableQuestion, 'answerKey'>, optionIndex: number): Grade {
  const key = answerKeys.mcq.parse(q.answerKey);
  const isCorrect = optionIndex === key.optionIndex;
  return { isCorrect, score: isCorrect ? 1 : 0, gradedBy: 'auto' };
}

const bad = (message: string) => new CourseError('invalid_question', [{ code: 'schema', message }]);

/**
 * Grades one answer on the server (P1). `mcq` is automatic; `short` is a normalised comparison first and
 * an LLM equivalence check only when that fails; `open` goes to the LLM against the rubric.
 */
export async function gradeAnswer(
  deps: GradingDeps,
  q: GradableQuestion,
  answer: unknown,
): Promise<Grade> {
  const parsed = studentAnswer[q.kind].safeParse(answer);
  if (!parsed.success) throw bad('The answer does not match the question type.');
  const subject = { type: 'question', id: q.id };

  if (q.kind === 'mcq') {
    return gradeMcq(q, (parsed.data as { optionIndex: number }).optionIndex);
  }

  const given = (parsed.data as { text: string }).text.trim();
  if (given === '') return { isCorrect: false, score: 0, gradedBy: 'auto' };

  if (q.kind === 'short') {
    const { accepted } = answerKeys.short.parse(q.answerKey);
    const wanted = new Set(accepted.map(normalizeAnswer));
    if (wanted.has(normalizeAnswer(given))) return { isCorrect: true, score: 1, gradedBy: 'auto' };
    const run = await deps.llm.generate({
      purpose: 'open_grading',
      promptVersion: SHORT_GRADER_VERSION,
      system: SHORT_GRADER_SYSTEM,
      prompt: shortGraderPrompt(q.promptMd, accepted, given),
      schema: shortEquivalence,
      subject,
    });
    const isCorrect = run.data.equivalent;
    return { isCorrect, score: isCorrect ? 1 : 0, gradedBy: 'llm', graderRunId: run.runId };
  }

  const { reference } = answerKeys.open.parse(q.answerKey);
  const run = await deps.llm.generate({
    purpose: 'open_grading',
    promptVersion: OPEN_GRADER_VERSION,
    system: OPEN_GRADER_SYSTEM,
    prompt: openGraderPrompt(q.promptMd, reference, q.rubric ?? '', given),
    schema: openGrade,
    subject,
  });
  return {
    isCorrect: run.data.score >= deps.openPassThreshold,
    score: run.data.score,
    gradedBy: 'llm',
    graderRunId: run.runId,
  };
}
