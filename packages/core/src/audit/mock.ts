import { MockLLMProvider, type LLMRequest } from '@eduforge/llm';
import type { AuditMaterial } from './material';
import { SECTION, SUMMARY_PREFIX } from './prompts';
import type { AuditLevel } from './rating';

/** The first lines under `marker`, up to the next blank line. */
function block(prompt: string, marker: string): string[] {
  const start = prompt.indexOf(`${marker}\n`);
  if (start < 0) return [];
  return prompt
    .slice(start + marker.length + 1)
    .split('\n\n')[0]!
    .split('\n')
    .filter((l) => l.trim() !== '');
}

/** The course text itself: the node titles and summaries are the author's claims, not evidence. */
const afterContent = (prompt: string) => {
  const i = prompt.indexOf(`${SECTION.content}\n`);
  return i < 0
    ? ''
    : prompt
        .slice(i + SECTION.content.length + 1)
        .split('\n')
        .filter((l) => !l.startsWith('### ') && !l.startsWith(SUMMARY_PREFIX))
        .join('\n');
};

const declarationOf = (prompt: string) =>
  JSON.parse(block(prompt, SECTION.declaration)[0] ?? '{}') as AuditMaterial['declaration'];

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** Ukrainian words change their endings, so words are compared by their first five letters. */
const stem = (w: string) => w.slice(0, 5);
const significant = (s: string) => [...new Set(wordsOf(s).filter((w) => w.length >= 5))];

function mockConformity(req: LLMRequest) {
  const d = declarationOf(req.prompt);
  const corpus = new Set(wordsOf(afterContent(req.prompt)).map(stem));
  const promised = significant(`${d.title} ${d.description}`);
  const missing = promised.filter((w) => !corpus.has(stem(w)));
  const covered = promised.length === 0 ? 1 : (promised.length - missing.length) / promised.length;
  const matches = covered >= 0.4;
  return {
    matches,
    mismatches: matches
      ? []
      : missing.slice(0, 5).map((w) => `Опис обіцяє «${w}», але в матеріалах цього немає.`),
    feedback: matches
      ? 'Mock: матеріали відповідають опису курсу.'
      : `Mock: лише ${Math.round(covered * 100)}% ключових слів опису зустрічаються в матеріалах.`,
  };
}

function mockSkills(req: LLMRequest) {
  const rows = block(req.prompt, SECTION.skills).map(
    (l) => JSON.parse(l) as AuditMaterial['skills'][number],
  );
  return {
    skills: rows.map((s) => {
      const corpus = new Set(wordsOf(s.material).map(stem));
      const name = significant(s.name);
      const covered = name.length > 0 && name.some((w) => corpus.has(stem(w)));
      return {
        skillId: s.id,
        covered,
        note: covered
          ? 'Mock: навичка згадується в матеріалах.'
          : `Mock: у матеріалах немає нічого про «${s.name}».`,
      };
    }),
  };
}

const levelFor = (charsPerNode: number): AuditLevel =>
  charsPerNode < 500
    ? 'junior'
    : charsPerNode < 1500
      ? 'middle'
      : charsPerNode < 3500
        ? 'senior'
        : 'expert';

/** The Mock's rule of thumb: the level follows the text volume per node, the hardness the questions and the code. */
function mockScoring(req: LLMRequest) {
  const m = JSON.parse(block(req.prompt, SECTION.metrics)[0] ?? '{}') as AuditMaterial['metrics'];
  const base =
    0.5 * m.questions.avgDifficulty +
    0.3 * Math.min(m.codeBlocksPerNode / 2, 1) +
    0.2 * m.questions.openShare;
  // Runs differ a little, as real ones do, so the median has something to do.
  const run = Number((req.params as { run?: number } | undefined)?.run ?? 0);
  const hardness = Math.min(1, Math.max(0, base + ((run % 3) - 1) * 0.02));
  return {
    level: levelFor(m.charsPerNode),
    hardness: Math.round(hardness * 100) / 100,
    feedback: {
      theoryDepth: `Mock: близько ${m.charsPerNode} символів теорії на вузол.`,
      questionTrickiness: `Mock: середня складність питань ${m.questions.avgDifficulty}.`,
      edgeCases: `Mock: ${m.codeBlocksPerNode} блоків коду на вузол.`,
    },
  };
}

export const auditMockResponders = {
  audit_conformity: mockConformity,
  audit_skills: mockSkills,
  audit_scoring: mockScoring,
};

/** A deterministic stand-in for the auditor (P4): it reads the prompt back and judges by word overlap and text volume. */
export const createAuditMock = () => new MockLLMProvider(auditMockResponders);
