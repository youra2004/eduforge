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

/** Wait between the immediate and the delayed post-test (RESEARCH.md), already scaled for the current TIME_SCALE. */
export function experimentDelaySeconds(config: {
  timeScale: number;
  experiment: { delaySeconds: number };
}): number {
  return scaleSeconds(config.experiment.delaySeconds, config.timeScale);
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The "day" a recommendation belongs to (F7-R2), as a number of days since 1970-01-01. A day lasts 24 h / TIME_SCALE, so
 * in demo mode (1440 → a minute) the one-run-per-day limit lets the job run again after a minute (ADR-0015).
 */
export function recommendationDayIndex(now: Date, timeScale: number): number {
  return Math.floor(now.getTime() / 1000 / scaleSeconds(DAY_SECONDS, timeScale));
}

/** When the daily recommendation job runs: 06:00 at TIME_SCALE=1, otherwise every "day" of demo time, in whole minutes (pg-boss schedules by cron). */
export function recommendationCron(timeScale: number): string {
  if (timeScale <= 1) return '0 6 * * *';
  const minutes = Math.max(1, Math.round(scaleSeconds(DAY_SECONDS, timeScale) / 60));
  return minutes >= 60 ? `0 */${Math.round(minutes / 60)} * * *` : `*/${minutes} * * * *`;
}
