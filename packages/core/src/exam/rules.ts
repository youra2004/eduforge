import type { ExamSkillLevel, ExamSkillResult, QuestionKind } from '@eduforge/db';
import { mulberry32, shuffle } from '../learning/assemble';

// Pure exam rules (F8): nothing here reads the clock or the database, so tests can pin every case.

export interface ExamProfile {
  maxRating: number;
  questions: number;
  minutes: number;
}

/** F8-R2: how many questions and how long, by the course rating. An unrated version gets the lowest profile. */
export function examProfile(profiles: ExamProfile[], rating: number | null): ExamProfile {
  const r = rating ?? 1;
  return profiles.find((p) => r <= p.maxRating) ?? profiles[profiles.length - 1]!;
}

export interface QuestionLimits {
  /** `mcq` and `short`. */
  choiceSeconds: number;
  openSeconds: number;
}

export const questionSeconds = (kind: QuestionKind, limits: QuestionLimits) =>
  kind === 'open' ? limits.openSeconds : limits.choiceSeconds;

export interface ExamSkillPool {
  skillId: string;
  /** Validated `exam`-pool questions of the course for this skill. */
  questionIds: string[];
}

export type ExamAssembly =
  { ok: true; questionIds: string[] } | { ok: false; emptySkillIds: string[] };

/**
 * F8-R2: `total` questions spread evenly over the skills, round by round, so shares differ by at most one;
 * a skill with fewer questions than its share gives what it has and the others fill up. When the whole pool is
 * smaller than `total` the exam is as long as the pool. A skill with no question cannot be examined at all.
 * The order is random; the seed is stored so a set can be rebuilt (D-18b).
 */
export function assembleExam(input: {
  skills: ExamSkillPool[];
  total: number;
  seed: number;
}): ExamAssembly {
  const emptySkillIds = input.skills
    .filter((s) => s.questionIds.length === 0)
    .map((s) => s.skillId);
  if (input.skills.length === 0 || emptySkillIds.length > 0) return { ok: false, emptySkillIds };
  const rng = mulberry32(input.seed);
  const queues = shuffle(input.skills, rng).map((s) => shuffle(s.questionIds, rng));
  const picked: string[] = [];
  while (picked.length < input.total && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      if (picked.length >= input.total) break;
      const next = queue.shift();
      if (next) picked.push(next);
    }
  }
  return { ok: true, questionIds: shuffle(picked, rng) };
}

export interface ClockItem {
  id: string;
  ord: number;
  kind: QuestionKind;
  shownAt: Date | null;
  answeredAt: Date | null;
}

export interface ExamClock {
  /** Unanswered questions whose time ran out: closed with no points, at the moment their time ended. */
  missed: { id: string; shownAt: Date; at: Date }[];
  /** The one question to answer now, with the instant its time ends; `null` when nothing is left. */
  current: { id: string; shownAt: Date; deadline: Date } | null;
}

/**
 * F8-R3 / P1: the whole exam runs on server time. A question is shown when the previous one was answered or
 * timed out, and ends at `shown + its limit` or at the exam deadline, whichever is first. An answer at the
 * exact deadline still counts; one a moment later does not. Questions that ran out while nobody looked are
 * closed in order, each at its own deadline, so the result does not depend on when the page is opened.
 */
export function examClock(input: {
  items: ClockItem[];
  startedAt: Date;
  deadlineAt: Date;
  limits: QuestionLimits;
  now: Date;
}): ExamClock {
  const missed: ExamClock['missed'] = [];
  let boundary = input.startedAt;
  for (const item of [...input.items].sort((a, b) => a.ord - b.ord)) {
    if (item.answeredAt) {
      boundary = item.answeredAt;
      continue;
    }
    const shownAt = new Date(
      Math.min((item.shownAt ?? boundary).getTime(), input.deadlineAt.getTime()),
    );
    const deadline = new Date(
      Math.min(
        shownAt.getTime() + questionSeconds(item.kind, input.limits) * 1000,
        input.deadlineAt.getTime(),
      ),
    );
    if (input.now > deadline) {
      missed.push({ id: item.id, shownAt, at: deadline });
      boundary = deadline;
      continue;
    }
    return { missed, current: { id: item.id, shownAt, deadline } };
  }
  return { missed, current: null };
}

const EPSILON = 1e-9;

export interface ScoreRules {
  /** 0..1, the exam is passed from this share of points (D-18). */
  passPct: number;
  /** 0..1, a skill is "perfect" from this share (D-25). */
  perfectPct: number;
}

/** F8-R7: ≥ 90 % perfect, 70–89 % good, below that needs work. Boundaries are inclusive. */
export function skillLevel(pct: number, rules: ScoreRules): ExamSkillLevel {
  if (pct + EPSILON >= rules.perfectPct * 100) return 'perfect';
  if (pct + EPSILON >= rules.passPct * 100) return 'good';
  return 'needs_work';
}

export interface ExamScore {
  scorePct: number;
  passed: boolean;
  perSkill: ExamSkillResult[];
}

/**
 * F8-R4: the share of points over all questions (a missed question is 0), and the same per skill.
 * `items` carry the points of each asked question (0..1). Only skills that were asked about are listed.
 */
export function scoreExam(
  items: { skillId: string; score: number }[],
  skills: { skillId: string; name: string }[],
  rules: ScoreRules,
): ExamScore {
  const pct = (points: number, count: number) => (count === 0 ? 0 : (points * 100) / count);
  const scorePct = pct(
    items.reduce((sum, i) => sum + i.score, 0),
    items.length,
  );
  const perSkill = skills.flatMap((s) => {
    const own = items.filter((i) => i.skillId === s.skillId);
    if (own.length === 0) return [];
    const skillPct = pct(
      own.reduce((sum, i) => sum + i.score, 0),
      own.length,
    );
    return [
      { skillId: s.skillId, name: s.name, pct: skillPct, level: skillLevel(skillPct, rules) },
    ];
  });
  return { scorePct, passed: scorePct + EPSILON >= rules.passPct * 100, perSkill };
}

export interface AttemptRow {
  roundNo: number;
  attemptNo: number;
  status: 'in_progress' | 'submitted' | 'passed' | 'failed' | 'interrupted' | 'annulled';
  submittedAt: Date | null;
}

export interface ExamRoundRules {
  attemptsPerRound: number;
  /** Already scaled by TIME_SCALE (`examCooldownSeconds`). */
  cooldownSeconds: number;
}

export interface RoundState {
  passed: boolean;
  /** The round and attempt number the next exam would have. */
  roundNo: number;
  attemptNo: number;
  attemptsLeft: number;
  /** Set while the pause after an exhausted round lasts. */
  cooldownUntil: Date | null;
}

/**
 * F8-R5: a round has `attemptsPerRound` attempts; after the last one is used the student waits out the pause and
 * a new round starts. An attempt is used when it ended as passed, failed or annulled; an interrupted one is not
 * over yet (F8-R6). Derived from the attempts alone, so a fake clock is all a test needs.
 */
export function examRounds(rows: AttemptRow[], rules: ExamRoundRules, now: Date): RoundState {
  const used = rows.filter((r) => ['passed', 'failed', 'annulled'].includes(r.status));
  if (used.some((r) => r.status === 'passed')) {
    return { passed: true, roundNo: 0, attemptNo: 0, attemptsLeft: 0, cooldownUntil: null };
  }
  const roundNo = used.reduce((max, r) => Math.max(max, r.roundNo), 1);
  const inRound = used.filter((r) => r.roundNo === roundNo);
  if (inRound.length < rules.attemptsPerRound) {
    return {
      passed: false,
      roundNo,
      attemptNo: inRound.length + 1,
      attemptsLeft: rules.attemptsPerRound - inRound.length,
      cooldownUntil: null,
    };
  }
  const last = Math.max(...inRound.map((r) => r.submittedAt?.getTime() ?? 0));
  const until = new Date(last + rules.cooldownSeconds * 1000);
  if (now < until) {
    // No attempt is left, so the number shown stays that of the last one used.
    return {
      passed: false,
      roundNo,
      attemptNo: inRound.length,
      attemptsLeft: 0,
      cooldownUntil: until,
    };
  }
  return {
    passed: false,
    roundNo: roundNo + 1,
    attemptNo: 1,
    attemptsLeft: rules.attemptsPerRound,
    cooldownUntil: null,
  };
}
