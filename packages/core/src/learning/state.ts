import type { NodeState } from '@eduforge/db';

export interface ProgressState {
  state: NodeState;
  roundNo: number;
  attemptsInRound: number;
  cooldownUntil: Date | null;
}

export interface RoundRules {
  attemptsPerRound: number;
  /** Already scaled by TIME_SCALE (`nodeCooldownSeconds`). */
  cooldownSeconds: number;
}

/** F5-R4: when the pause is over, the next round starts. Nothing happens early, whatever the client says. */
export function refreshCooldown(p: ProgressState, now: Date): ProgressState {
  if (p.state !== 'cooldown' || !p.cooldownUntil || now < p.cooldownUntil) return p;
  return { state: 'available', roundNo: p.roundNo + 1, attemptsInRound: 0, cooldownUntil: null };
}

/**
 * What a finished node test does to the node. A fail inside a round keeps the node open for remediation;
 * the last failed attempt of the round starts the pause.
 */
export function afterNodeTest(
  p: ProgressState,
  passed: boolean,
  rules: RoundRules,
  now: Date,
): ProgressState {
  if (passed) return { ...p, state: 'passed', cooldownUntil: null };
  const attemptsInRound = p.attemptsInRound + 1;
  if (attemptsInRound >= rules.attemptsPerRound) {
    return {
      ...p,
      state: 'cooldown',
      attemptsInRound,
      cooldownUntil: new Date(now.getTime() + rules.cooldownSeconds * 1000),
    };
  }
  return { ...p, state: 'in_progress', attemptsInRound };
}
