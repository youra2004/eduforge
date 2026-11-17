/** The rating formula of F4-R4/F4-R5 and the volume cap of F4-R1, as pure functions. Parameters come from config (P2). */

export const auditLevels = ['junior', 'middle', 'senior', 'expert'] as const;
export type AuditLevel = (typeof auditLevels)[number];

/** The rating an `expert`-level course would get; only a human expert may confirm it (F4-R6). */
export const TOP_RATING = 10;

/** Score band per level (D-07). `expert` has no band: it is the candidate for `TOP_RATING`. */
export const DEFAULT_BANDS = {
  junior: [1, 3],
  middle: [4, 6],
  senior: [7, 9],
} as const;

export interface VolumeCapStep {
  /** Courses with fewer nodes than this get `cap` (the first matching step wins). */
  below: number;
  cap: number;
}

export interface RatingConfig {
  bands: Record<Exclude<AuditLevel, 'expert'>, readonly [number, number]>;
  volumeCaps: VolumeCapStep[];
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  bands: DEFAULT_BANDS,
  volumeCaps: [
    { below: 6, cap: 3 },
    { below: 12, cap: 6 },
    { below: 20, cap: 9 },
  ],
};

/** F4-R1: the highest rating a course of this size may get. Beyond the last step the cap is 10. */
export function volumeCap(nodeCount: number, steps: VolumeCapStep[]): number {
  return steps.find((s) => nodeCount < s.below)?.cap ?? TOP_RATING;
}

/** F4-R5: `band_min + round(hardness × (band_max − band_min))`; `expert` is the candidate for 10. */
export function aiScore(level: AuditLevel, hardness: number, config: RatingConfig): number {
  if (level === 'expert') return TOP_RATING;
  const [min, max] = config.bands[level];
  const h = Math.min(1, Math.max(0, hardness));
  return min + Math.round(h * (max - min));
}

export interface RatingResult {
  aiScore: number;
  volumeCap: number;
  /** `min(ai_score, volume_cap)` (D-08). */
  final: number;
  /** The volume cap, not the course's depth, held the score down. */
  limitedByVolume: boolean;
  /** `final` is 10: auto-publication is blocked and the version goes to an expert (F4-R6). */
  needsExpert: boolean;
}

export function rate(
  level: AuditLevel,
  hardness: number,
  nodeCount: number,
  config: RatingConfig,
): RatingResult {
  const score = aiScore(level, hardness, config);
  const cap = volumeCap(nodeCount, config.volumeCaps);
  const final = Math.min(score, cap);
  return {
    aiScore: score,
    volumeCap: cap,
    final,
    limitedByVolume: cap < score,
    needsExpert: final === TOP_RATING,
  };
}

export interface ScoringRun {
  level: AuditLevel;
  hardness: number;
}

/**
 * The median of the N scoring runs (F4-R4): the level by its order, the hardness by value. With an even number of
 * runs the lower level and the mean of the two middle hardness values are taken, so a tie never rounds a course up.
 */
export function medianRun(runs: ScoringRun[]): ScoringRun {
  if (runs.length === 0) throw new Error('medianRun needs at least one run');
  const levels = runs.map((r) => auditLevels.indexOf(r.level)).sort((a, b) => a - b);
  const hardness = runs.map((r) => r.hardness).sort((a, b) => a - b);
  const mid = Math.floor((runs.length - 1) / 2);
  const hi = Math.floor(runs.length / 2);
  return {
    level: auditLevels[levels[mid]!]!,
    hardness: (hardness[mid]! + hardness[hi]!) / 2,
  };
}
