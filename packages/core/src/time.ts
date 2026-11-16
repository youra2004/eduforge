/** Scales a real-time duration by TIME_SCALE (demo mode): 24 h at scale 1440 becomes 60 s. */
export function scaleSeconds(seconds: number, timeScale: number): number {
  return seconds / timeScale;
}

/** Pause after an exhausted node-test round (F5-R4), already scaled for the current TIME_SCALE. */
export function nodeCooldownSeconds(config: {
  timeScale: number;
  node: { cooldownSeconds: number };
}): number {
  return scaleSeconds(config.node.cooldownSeconds, config.timeScale);
}

/** Pause after an exhausted exam round (F8-R5), already scaled for the current TIME_SCALE. */
export function examCooldownSeconds(config: {
  timeScale: number;
  exam: { cooldownSeconds: number };
}): number {
  return scaleSeconds(config.exam.cooldownSeconds, config.timeScale);
}
