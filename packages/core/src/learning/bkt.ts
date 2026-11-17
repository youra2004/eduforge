export interface BktParams {
  /** P(known) before the answer. */
  p: number;
  correct: boolean;
  /** Chance of a correct answer without knowing the skill (per question, F3-R5). */
  guess: number;
  /** Chance of a wrong answer despite knowing the skill. */
  slip: number;
  /** Chance of learning the skill from the opportunity itself. */
  learn: number;
}

/** F5-R2: Bayesian update on the answer, then the learning step. */
export function bktUpdate({ p, correct, guess, slip, learn }: BktParams): number {
  const known = correct ? p * (1 - slip) : p * slip;
  const unknown = correct ? (1 - p) * guess : (1 - p) * (1 - guess);
  const denominator = known + unknown;
  // Only reachable with a degenerate guess/slip of 0 or 1; keep the prior rather than produce NaN.
  const posterior = denominator === 0 ? p : known / denominator;
  return posterior + (1 - posterior) * learn;
}

/** D-11: a node is passed when every one of its skills is at or above the threshold. */
export function passesNode(pKnown: number[], threshold: number): boolean {
  // The epsilon keeps a value that is 0.8 up to float noise from failing a threshold of 0.8.
  return pKnown.length > 0 && pKnown.every((p) => p >= threshold - 1e-9);
}
