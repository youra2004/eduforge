/** A small seeded PRNG, so a test's question set can be rebuilt from `question_set_seed`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface SkillPool {
  skillId: string;
  /** Validated `node`-pool questions of this node for this skill. */
  questionIds: string[];
}

export type Assembly = { ok: true; questionIds: string[] } | { ok: false; shortSkillIds: string[] };

/**
 * F5-R3 / F5-R4: `perSkill` questions for every skill, questions the student has not been shown first
 * and already-seen ones only to fill up when the pool is exhausted; then one shuffled order across skills.
 */
export function assembleNodeTest(input: {
  skills: SkillPool[];
  seen: ReadonlySet<string>;
  perSkill: number;
  seed: number;
}): Assembly {
  const rng = mulberry32(input.seed);
  const picked: string[] = [];
  const shortSkillIds: string[] = [];
  for (const { skillId, questionIds } of input.skills) {
    const unseen = shuffle(
      questionIds.filter((id) => !input.seen.has(id)),
      rng,
    );
    const seen = shuffle(
      questionIds.filter((id) => input.seen.has(id)),
      rng,
    );
    const chosen = [...unseen, ...seen].slice(0, input.perSkill);
    if (chosen.length < input.perSkill) shortSkillIds.push(skillId);
    picked.push(...chosen);
  }
  if (shortSkillIds.length > 0) return { ok: false, shortSkillIds };
  return { ok: true, questionIds: shuffle(picked, rng) };
}
