import type { Question, QuestionKind } from '@eduforge/db';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * The shape of a question body, shared by the author's form and by the generator's output.
 * `correctIndex` / `accepted` / `reference` / `rubric` end up in `answer_key` and `rubric` (never student-facing, P6).
 */
export const questionBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcq'),
    skillId: z.uuid(),
    promptMd: text(5000),
    options: z.array(text(1000)).min(2).max(6),
    correctIndex: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('short'),
    skillId: z.uuid(),
    promptMd: text(5000),
    accepted: z.array(text(500)).min(1).max(10),
  }),
  z.object({
    kind: z.literal('open'),
    skillId: z.uuid(),
    promptMd: text(5000),
    reference: text(5000),
    rubric: text(5000),
  }),
]);
export type QuestionBody = z.infer<typeof questionBody>;

export const generatorOutput = z.object({ questions: z.array(questionBody).max(200) });

export const validatorOutput = z.object({
  keyCorrect: z.boolean(),
  unambiguous: z.boolean(),
  matchesSkill: z.boolean(),
  difficulty: z.number().min(0).max(1),
  reason: z.string().max(2000),
});

/** What a student sends for each kind. */
export const studentAnswer = {
  mcq: z.object({ optionIndex: z.number().int() }),
  short: z.object({ text: z.string().max(2000) }),
  open: z.object({ text: z.string().max(8000) }),
} satisfies Record<QuestionKind, z.ZodType>;

export const shortEquivalence = z.object({ equivalent: z.boolean(), reason: z.string().max(1000) });
export const openGrade = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string().max(2000),
});

/** F3-R5: the chance of answering correctly without knowing the skill. */
export function guessFor(kind: QuestionKind, optionCount = 0): number {
  if (kind === 'mcq') return 1 / Math.max(2, optionCount);
  return kind === 'short' ? 0.1 : 0.05;
}

/** Checks the pieces that depend on each other (the key must point at an option) and builds the stored columns. */
export function toColumns(body: QuestionBody):
  | {
      ok: true;
      value: Pick<Question, 'kind' | 'promptMd' | 'options' | 'answerKey' | 'rubric' | 'guess'>;
    }
  | { ok: false; message: string } {
  const base = { kind: body.kind, promptMd: body.promptMd };
  if (body.kind === 'mcq') {
    if (new Set(body.options.map((o) => o.toLowerCase())).size !== body.options.length) {
      return { ok: false, message: 'Options must be different from each other.' };
    }
    if (body.correctIndex >= body.options.length) {
      return { ok: false, message: 'The correct option must be one of the options.' };
    }
    return {
      ok: true,
      value: {
        ...base,
        options: body.options,
        answerKey: { optionIndex: body.correctIndex },
        rubric: null,
        guess: guessFor('mcq', body.options.length),
      },
    };
  }
  if (body.kind === 'short') {
    return {
      ok: true,
      value: {
        ...base,
        options: null,
        answerKey: { accepted: body.accepted },
        rubric: null,
        guess: guessFor('short'),
      },
    };
  }
  return {
    ok: true,
    value: {
      ...base,
      options: null,
      answerKey: { reference: body.reference },
      rubric: body.rubric,
      guess: guessFor('open'),
    },
  };
}

/** The stored key, read back with its shape checked. */
export const answerKeys = {
  mcq: z.object({ optionIndex: z.number().int().min(0) }),
  short: z.object({ accepted: z.array(z.string()).min(1) }),
  open: z.object({ reference: z.string() }),
} satisfies Record<QuestionKind, z.ZodType>;
