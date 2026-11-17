/**
 * Normalized gain (RESEARCH.md §3): `(post − pre) / (1 − pre)`, scores in 0..1. A participant who already scored
 * 1 on the pre-test has nothing left to gain, so the gain is undefined (`null`) and the analysis leaves them out.
 */
export function normalizedGain(pre: number, post: number): number | null {
  if (pre >= 1) return null;
  return (post - pre) / (1 - pre);
}
