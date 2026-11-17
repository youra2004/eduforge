import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import {
  assembleExam,
  examClock,
  examProfile,
  examRounds,
  scoreExam,
  skillLevel,
  type AttemptRow,
  type ClockItem,
} from './rules';

const profiles = loadConfig({ DATABASE_URL: 'x' }).exam.profiles;
const rules = { passPct: 0.7, perfectPct: 0.9 };
const T0 = new Date('2026-03-01T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('exam profile by rating (F8-R2)', () => {
  it.each([
    [1, 20, 45],
    [3, 20, 45],
    [4, 30, 60],
    [6, 30, 60],
    [7, 40, 90],
    [10, 40, 90],
  ])('rating %i asks %i questions in %i minutes', (rating, questions, minutes) => {
    expect(examProfile(profiles, rating)).toMatchObject({ questions, minutes });
  });

  it('gives an unrated version the lowest profile', () => {
    expect(examProfile(profiles, null).questions).toBe(20);
  });
});

describe('assembleExam', () => {
  const pool = (counts: number[]) =>
    counts.map((n, i) => ({
      skillId: `s${i}`,
      questionIds: Array.from({ length: n }, (_, k) => `s${i}-q${k}`),
    }));
  const perSkill = (ids: string[]) =>
    ids.reduce<Record<string, number>>((m, id) => {
      const skill = id.split('-')[0]!;
      m[skill] = (m[skill] ?? 0) + 1;
      return m;
    }, {});

  it('spreads the questions evenly over the skills', () => {
    const r = assembleExam({ skills: pool([10, 10, 10, 10]), total: 20, seed: 1 });
    expect(r.ok && perSkill(r.questionIds)).toEqual({ s0: 5, s1: 5, s2: 5, s3: 5 });
  });

  it('keeps shares within one of each other when they do not divide', () => {
    const r = assembleExam({ skills: pool([10, 10, 10]), total: 20, seed: 7 });
    const counts = Object.values(r.ok ? perSkill(r.questionIds) : {}).sort();
    expect(counts).toEqual([6, 7, 7]);
  });

  it('lets other skills fill up for a skill with a small pool', () => {
    const r = assembleExam({ skills: pool([2, 20, 20]), total: 20, seed: 3 });
    const counts = r.ok ? perSkill(r.questionIds) : {};
    expect(counts.s0).toBe(2);
    expect(r.ok && r.questionIds).toHaveLength(20);
  });

  it('is as long as the pool when the pool is smaller than asked', () => {
    const r = assembleExam({ skills: pool([3, 3, 3, 3]), total: 20, seed: 1 });
    expect(r.ok && r.questionIds).toHaveLength(12);
  });

  it('never repeats a question and is the same for the same seed', () => {
    const a = assembleExam({ skills: pool([8, 8, 8]), total: 20, seed: 42 });
    const b = assembleExam({ skills: pool([8, 8, 8]), total: 20, seed: 42 });
    expect(a).toEqual(b);
    expect(a.ok && new Set(a.questionIds).size).toBe(20);
  });

  it('draws a different set for a different seed', () => {
    const a = assembleExam({ skills: pool([10, 10, 10]), total: 15, seed: 1 });
    const b = assembleExam({ skills: pool([10, 10, 10]), total: 15, seed: 2 });
    expect(a.ok && b.ok && a.questionIds.join() !== b.questionIds.join()).toBe(true);
  });

  it('refuses a skill with no question', () => {
    expect(assembleExam({ skills: pool([5, 0]), total: 4, seed: 1 })).toEqual({
      ok: false,
      emptySkillIds: ['s1'],
    });
  });
});

describe('examClock (F8-R3, P1)', () => {
  const limits = { choiceSeconds: 90, openSeconds: 300 };
  const item = (ord: number, extra: Partial<ClockItem> = {}): ClockItem => ({
    id: `i${ord}`,
    ord,
    kind: 'mcq',
    shownAt: null,
    answeredAt: null,
    ...extra,
  });
  const clock = (items: ClockItem[], now: Date, deadlineSeconds = 3600) =>
    examClock({ items, startedAt: T0, deadlineAt: at(deadlineSeconds), limits, now });

  it('shows the first unanswered question with its own deadline', () => {
    const c = clock([item(0, { shownAt: T0 }), item(1)], at(10));
    expect(c.current).toEqual({ id: 'i0', shownAt: T0, deadline: at(90) });
    expect(c.missed).toEqual([]);
  });

  it('accepts an answer at the exact deadline and not a moment later', () => {
    const items = [item(0, { shownAt: T0 }), item(1)];
    expect(clock(items, at(90)).current?.id).toBe('i0');
    expect(clock(items, new Date(at(90).getTime() + 1)).current?.id).toBe('i1');
  });

  it('gives an open question five minutes', () => {
    const c = clock([item(0, { kind: 'open', shownAt: T0 })], at(299));
    expect(c.current?.deadline).toEqual(at(300));
  });

  it('closes questions that ran out unseen, each at its own deadline, and shows the next one', () => {
    const c = clock([item(0, { shownAt: T0 }), item(1), item(2)], at(200));
    expect(c.missed.map((m) => [m.id, m.at])).toEqual([
      ['i0', at(90)],
      ['i1', at(180)],
    ]);
    expect(c.current).toEqual({ id: 'i2', shownAt: at(180), deadline: at(270) });
  });

  it('starts the next question when the previous one was answered, not when it would have ended', () => {
    const c = clock([item(0, { shownAt: T0, answeredAt: at(20) }), item(1)], at(30));
    expect(c.current).toEqual({ id: 'i1', shownAt: at(20), deadline: at(110) });
  });

  it('cuts a question short at the exam deadline', () => {
    const c = clock([item(0, { shownAt: at(50) })], at(60), 70);
    expect(c.current?.deadline).toEqual(at(70));
  });

  it('closes everything once the exam deadline has passed', () => {
    const c = clock([item(0, { shownAt: T0 }), item(1), item(2)], at(500), 100);
    expect(c.current).toBeNull();
    expect(c.missed.map((m) => m.id)).toEqual(['i0', 'i1', 'i2']);
    expect(c.missed.every((m) => m.at <= at(100))).toBe(true);
  });

  it('has nothing to show when everything is answered', () => {
    const c = clock([item(0, { shownAt: T0, answeredAt: at(5) })], at(10));
    expect(c).toEqual({ missed: [], current: null });
  });
});

describe('scoreExam (F8-R4, F8-R7)', () => {
  const skills = [
    { skillId: 'a', name: 'A' },
    { skillId: 'b', name: 'B' },
    { skillId: 'c', name: 'C' },
  ];
  const items = (a: number[], b: number[], c: number[] = []) => [
    ...a.map((score) => ({ skillId: 'a', score })),
    ...b.map((score) => ({ skillId: 'b', score })),
    ...c.map((score) => ({ skillId: 'c', score })),
  ];

  it('computes the share per skill and the levels on a fixture', () => {
    // A 9/10 = 90 % perfect, B 7/10 = 70 % good, C 6/10 = 60 % needs work; total 22/30.
    const r = scoreExam(
      items(
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        [1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
      ),
      skills,
      rules,
    );
    expect(r.perSkill.map((s) => [s.name, s.pct, s.level])).toEqual([
      ['A', 90, 'perfect'],
      ['B', 70, 'good'],
      ['C', 60, 'needs_work'],
    ]);
    expect(r.scorePct).toBeCloseTo((22 / 30) * 100, 9);
    expect(r.passed).toBe(true);
  });

  it('passes at exactly 70 % and fails just under it', () => {
    const exactly = scoreExam(items([1, 1, 1, 1, 1, 1, 1], [0, 0, 0]), skills, rules);
    expect(exactly.scorePct).toBe(70);
    expect(exactly.passed).toBe(true);
    const under = scoreExam(items([1, 1, 1, 1, 1, 1, 0.99], [0, 0, 0]), skills, rules);
    expect(under.scorePct).toBeLessThan(70);
    expect(under.passed).toBe(false);
  });

  it('is not thrown off by floating point at the boundary (7 of 10, 0.7 × 100)', () => {
    expect(scoreExam(items(Array(7).fill(1), Array(3).fill(0)), skills, rules).passed).toBe(true);
    expect(scoreExam(items(Array(21).fill(1), Array(9).fill(0)), skills, rules).passed).toBe(true);
  });

  it('counts partial points of open answers', () => {
    const r = scoreExam(items([0.5, 0.5, 1, 1], []), skills, rules);
    expect(r.perSkill[0]!.pct).toBe(75);
  });

  it('lists only the skills that were asked about', () => {
    expect(scoreExam(items([1], [0]), skills, rules).perSkill.map((s) => s.skillId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('puts the level boundaries at 90 and 70 inclusive', () => {
    expect(skillLevel(90, rules)).toBe('perfect');
    expect(skillLevel(89.9, rules)).toBe('good');
    expect(skillLevel(70, rules)).toBe('good');
    expect(skillLevel(69.9, rules)).toBe('needs_work');
  });
});

describe('examRounds (F8-R5)', () => {
  const week = 7 * 24 * 60 * 60;
  const rule = { attemptsPerRound: 2, cooldownSeconds: week };
  const failed = (roundNo: number, attemptNo: number, seconds: number): AttemptRow => ({
    roundNo,
    attemptNo,
    status: 'failed',
    submittedAt: at(seconds),
  });

  it('starts with the first attempt of the first round', () => {
    expect(examRounds([], rule, T0)).toMatchObject({ roundNo: 1, attemptNo: 1, attemptsLeft: 2 });
  });

  it('leaves one attempt after one failure', () => {
    expect(examRounds([failed(1, 1, 0)], rule, at(100))).toMatchObject({
      roundNo: 1,
      attemptNo: 2,
      attemptsLeft: 1,
      cooldownUntil: null,
    });
  });

  it('pauses for seven days after two failures, then opens a new round', () => {
    const rows = [failed(1, 1, 0), failed(1, 2, 1000)];
    const paused = examRounds(rows, rule, at(1000 + week - 1));
    expect(paused).toMatchObject({ roundNo: 1, attemptNo: 2, attemptsLeft: 0 });
    expect(paused.cooldownUntil).toEqual(at(1000 + week));
    expect(examRounds(rows, rule, at(1000 + week))).toMatchObject({
      roundNo: 2,
      attemptNo: 1,
      attemptsLeft: 2,
      cooldownUntil: null,
    });
  });

  it('does not count an interrupted attempt as used', () => {
    const rows: AttemptRow[] = [
      { roundNo: 1, attemptNo: 1, status: 'interrupted', submittedAt: at(5) },
    ];
    expect(examRounds(rows, rule, at(10))).toMatchObject({ attemptNo: 1, attemptsLeft: 2 });
  });

  it('is done after a pass', () => {
    const rows: AttemptRow[] = [
      failed(1, 1, 0),
      { roundNo: 1, attemptNo: 2, status: 'passed', submittedAt: at(10) },
    ];
    expect(examRounds(rows, rule, at(20)).passed).toBe(true);
  });
});
