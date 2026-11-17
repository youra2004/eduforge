import { MockLLMProvider, type LLMRequest } from '@eduforge/llm';
import { normalizeAnswer } from './grading';
import { OPEN_GRADER_VERSION, SECTION, type SkillInfo } from './prompts';

/** Everything after `marker` up to the next `## ` section. The theory is always last, so it runs to the end (it may hold `##` headings itself). */
function section(prompt: string, marker: string): string {
  const start = prompt.indexOf(`${marker}\n`);
  if (start < 0) return '';
  const rest = prompt.slice(start + marker.length + 1);
  const end = marker === SECTION.theory || marker === SECTION.answer ? -1 : rest.search(/\n\n## /);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

const parseSkills = (prompt: string): SkillInfo[] =>
  section(prompt, SECTION.skills)
    .split('\n')
    .map((l) => l.replace(/^- /, '').split(' | '))
    .filter((p) => p.length >= 2)
    .map(([id, name, description]) => ({ id: id!, name: name!, description: description ?? '' }));

const sentencesOf = (theory: string) => {
  const found = theory
    .split(/\n+/)
    .filter((l) => !l.startsWith('#'))
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
  return found.length > 0 ? found : [theory.trim() || 'Матеріал порожній.'];
};

const inTheory = (theory: string, needle: string) =>
  normalizeAnswer(theory).includes(normalizeAnswer(needle));

function mockGenerate(req: LLMRequest) {
  const perSkill = Number(/exactly (\d+) questions/.exec(req.prompt)?.[1] ?? 4);
  const skills = parseSkills(req.prompt);
  const sentences = sentencesOf(section(req.prompt, SECTION.theory));
  const questions = skills.flatMap((skill, si) =>
    Array.from({ length: perSkill }, (_, i) => {
      const sentence = sentences[(si * perSkill + i) % sentences.length]!;
      const kind = (['mcq', 'mcq', 'short', 'open'] as const)[i % 4]!;
      if (kind === 'mcq') {
        const correctIndex = i % 4;
        const distractors = [1, 2, 3].map(
          (d) => `Матеріал не підтверджує цього (варіант ${d}) для навички «${skill.name}».`,
        );
        const options = [...distractors];
        options.splice(correctIndex, 0, sentence);
        return {
          kind,
          skillId: skill.id,
          promptMd: `Яке твердження підтверджується матеріалом (навичка «${skill.name}»)?`,
          options,
          correctIndex,
        };
      }
      const words = sentence.replace(/[.!?]+$/, '').split(/\s+/);
      const last = words[words.length - 1]!;
      if (kind === 'short') {
        return {
          kind,
          skillId: skill.id,
          promptMd: `Завершіть речення з матеріалу одним словом: «${words.slice(0, -1).join(' ')} …»`,
          accepted: [last],
        };
      }
      return {
        kind,
        skillId: skill.id,
        promptMd: `Поясніть своїми словами, що в матеріалі сказано про «${words.slice(0, 3).join(' ')} …» (навичка «${skill.name}»).`,
        reference: sentence,
        rubric: `Відповідь має передати зміст: ${sentence}`,
      };
    }),
  );
  return { questions };
}

/** The validator's rule on the Mock: a key is right when the theory actually contains it. */
function mockValidate(req: LLMRequest) {
  const theory = section(req.prompt, SECTION.theory);
  const q = JSON.parse(section(req.prompt, SECTION.question)) as {
    kind: 'mcq' | 'short' | 'open';
    options: string[] | null;
    key: { optionIndex?: number; accepted?: string[]; reference?: string };
  };
  let keyCorrect: boolean;
  let unambiguous = true;
  if (q.kind === 'mcq') {
    keyCorrect = inTheory(theory, q.options![q.key.optionIndex!] ?? '');
    unambiguous = q.options!.filter((o) => inTheory(theory, o)).length === 1;
  } else if (q.kind === 'short') {
    keyCorrect = (q.key.accepted ?? []).some((a) => inTheory(theory, a));
  } else {
    keyCorrect = inTheory(theory, q.key.reference ?? '');
  }
  const reason = !keyCorrect
    ? 'The marked answer is not supported by the theory.'
    : !unambiguous
      ? 'More than one option is supported by the theory.'
      : 'The answer is stated in the theory.';
  return {
    keyCorrect,
    unambiguous,
    matchesSkill: true,
    difficulty: { mcq: 0.35, short: 0.5, open: 0.7 }[q.kind],
    reason,
  };
}

const words = (s: string) =>
  normalizeAnswer(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3);

function mockGrade(req: LLMRequest) {
  const answer = JSON.parse(section(req.prompt, SECTION.answer) || '""') as string;
  if (req.promptVersion === OPEN_GRADER_VERSION) {
    const reference = section(req.prompt, SECTION.reference);
    const want = [...new Set(words(reference))];
    const have = new Set(words(answer));
    const score = want.length === 0 ? 0 : want.filter((w) => have.has(w)).length / want.length;
    return {
      score: Math.round(score * 100) / 100,
      feedback: 'Mock: share of reference words used.',
    };
  }
  const accepted = section(req.prompt, SECTION.accepted)
    .split('\n')
    .map((l) => l.replace(/^- /, ''));
  const given = normalizeAnswer(answer);
  const equivalent = accepted.some((a) => given.includes(normalizeAnswer(a)));
  return { equivalent, reason: 'Mock: an accepted answer appears in the answer.' };
}

/**
 * A deterministic stand-in for the LLM (P4): the generator builds questions from the theory's own sentences,
 * the validator accepts a key only if the theory contains it, the grader compares words. Used in tests and demo.
 */
export const createQuestionMock = () =>
  new MockLLMProvider({
    question_generation: mockGenerate,
    question_validation: mockValidate,
    open_grading: mockGrade,
  });
