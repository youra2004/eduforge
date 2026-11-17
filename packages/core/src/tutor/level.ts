export const HINT_LEVELS = [1, 2, 3] as const;
export type HintLevel = (typeof HINT_LEVELS)[number];

/**
 * F6-R4: every request for help moves one step up the ladder (1 leading question, 2 pointer to a concept,
 * 3 worked analogous example) and stays at 3. The student cannot ask for a level; the server decides.
 */
export function chooseLevel(hintsGiven: number): HintLevel {
  return Math.min(3, Math.max(0, Math.floor(hintsGiven)) + 1) as HintLevel;
}

/** When the guard blocks a reply, the next try is one step lower (never below 1); level 1 has nowhere lower to go. */
export const lowerLevel = (level: HintLevel): HintLevel | null =>
  level > 1 ? ((level - 1) as HintLevel) : null;
