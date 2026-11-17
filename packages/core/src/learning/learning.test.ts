import { describe, expect, it } from 'vitest';
import { assembleNodeTest, mulberry32 } from './assemble';
import { bktUpdate, passesNode } from './bkt';
import { afterNodeTest, refreshCooldown, type ProgressState } from './state';

const defaults = { guess: 0.25, slip: 0.1, learn: 0.15 };
const run = (answers: boolean[], guess = defaults.guess) =>
  answers.reduce((p, correct) => bktUpdate({ p, correct, ...defaults, guess }), 0.2);

describe('bktUpdate', () => {
  it('one correct answer from p=0.20 gives ≈ 0.553', () => {
    expect(run([true])).toBeCloseTo(0.5526, 3);
  });

  it('two correct in a row from p=0.20 give ≈ 0.84 (milestone number)', () => {
    expect(run([true, true])).toBeCloseTo(0.844, 3);
  });

  it('matches the OQ-11 table: C,C,W ≈ 0.51; C,C,C,W ≈ 0.79; C,W,C,C ≈ 0.88', () => {
    expect(run([true, true, false])).toBeCloseTo(0.51, 2);
    expect(run([true, true, true, false])).toBeCloseTo(0.79, 2);
    expect(run([true, false, true, true])).toBeCloseTo(0.88, 2);
  });

  it('a wrong answer lowers p, a correct one raises it', () => {
    expect(bktUpdate({ p: 0.5, correct: false, ...defaults })).toBeLessThan(0.5);
    expect(bktUpdate({ p: 0.5, correct: true, ...defaults })).toBeGreaterThan(0.5);
  });

  it('a lower guess makes a correct answer worth more', () => {
    expect(run([true], 0.05)).toBeGreaterThan(run([true], 0.5));
  });

  it('never leaves [0,1] and survives degenerate parameters', () => {
    expect(bktUpdate({ p: 0, correct: true, guess: 0, slip: 0.1, learn: 0.15 })).toBeCloseTo(0.15);
    expect(bktUpdate({ p: 1, correct: false, guess: 1, slip: 0, learn: 0 })).toBe(1);
    for (const p of [0, 0.3, 1]) {
      const v = bktUpdate({ p, correct: false, guess: 0.25, slip: 0.1, learn: 0.15 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('passesNode', () => {
  it('needs every skill at or above the threshold', () => {
    expect(passesNode([0.85, 0.8], 0.8)).toBe(true);
    expect(passesNode([0.95, 0.79], 0.8)).toBe(false);
  });
  it('an empty skill list never passes', () => {
    expect(passesNode([], 0.8)).toBe(false);
  });
  it('treats float noise around the threshold as equal', () => {
    expect(passesNode([0.1 + 0.7], 0.8)).toBe(true);
  });
});

describe('assembleNodeTest', () => {
  const skills = [
    { skillId: 's1', questionIds: ['a1', 'a2', 'a3', 'a4'] },
    { skillId: 's2', questionIds: ['b1', 'b2', 'b3', 'b4'] },
  ];
  const ids = (r: ReturnType<typeof assembleNodeTest>) => {
    if (!r.ok) throw new Error('expected ok');
    return r.questionIds;
  };

  it('takes perSkill questions per skill', () => {
    const got = ids(assembleNodeTest({ skills, seen: new Set(), perSkill: 3, seed: 1 }));
    expect(got).toHaveLength(6);
    expect(got.filter((q) => q.startsWith('a'))).toHaveLength(3);
    expect(got.filter((q) => q.startsWith('b'))).toHaveLength(3);
  });

  it('shows unseen questions first and repeats a seen one only when the pool is exhausted', () => {
    const seen = new Set(['a1', 'a2', 'a3', 'b1']);
    const got = ids(assembleNodeTest({ skills, seen, perSkill: 3, seed: 7 }));
    expect(got).toContain('a4'); // the only unseen one of s1
    expect(got.filter((q) => q.startsWith('a')).filter((q) => seen.has(q))).toHaveLength(2);
    expect(got).toEqual(expect.arrayContaining(['b2', 'b3', 'b4'])); // 3 unseen: no repeats
    expect(got).not.toContain('b1');
  });

  it('is reproducible from the seed', () => {
    const a = assembleNodeTest({ skills, seen: new Set(), perSkill: 3, seed: 42 });
    const b = assembleNodeTest({ skills, seen: new Set(), perSkill: 3, seed: 42 });
    expect(a).toEqual(b);
  });

  it('reports the skills whose pool is too small instead of returning a short test', () => {
    const r = assembleNodeTest({
      skills: [skills[0]!, { skillId: 's2', questionIds: ['b1', 'b2'] }],
      seen: new Set(),
      perSkill: 3,
      seed: 1,
    });
    expect(r).toEqual({ ok: false, shortSkillIds: ['s2'] });
  });

  it('mulberry32 stays in [0,1)', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('node states', () => {
  const rules = { attemptsPerRound: 2, cooldownSeconds: 60 };
  const t0 = new Date('2026-01-01T00:00:00Z');
  const open: ProgressState = {
    state: 'available',
    roundNo: 1,
    attemptsInRound: 0,
    cooldownUntil: null,
  };

  it('a pass marks the node passed', () => {
    expect(afterNodeTest(open, true, rules, t0).state).toBe('passed');
  });

  it('the first fail of a round keeps the node open for remediation', () => {
    const p = afterNodeTest(open, false, rules, t0);
    expect(p).toMatchObject({ state: 'in_progress', attemptsInRound: 1, cooldownUntil: null });
  });

  it('the second fail starts the pause, scaled seconds from now', () => {
    const p = afterNodeTest(afterNodeTest(open, false, rules, t0), false, rules, t0);
    expect(p.state).toBe('cooldown');
    expect(p.cooldownUntil).toEqual(new Date('2026-01-01T00:01:00Z'));
  });

  it('the pause ends exactly at cooldownUntil and opens round 2 with fresh attempts', () => {
    const cooling = afterNodeTest(afterNodeTest(open, false, rules, t0), false, rules, t0);
    expect(refreshCooldown(cooling, new Date('2026-01-01T00:00:59Z'))).toBe(cooling);
    expect(refreshCooldown(cooling, new Date('2026-01-01T00:01:00Z'))).toEqual({
      state: 'available',
      roundNo: 2,
      attemptsInRound: 0,
      cooldownUntil: null,
    });
  });

  it('refreshCooldown leaves other states alone', () => {
    expect(refreshCooldown(open, t0)).toBe(open);
  });
});
