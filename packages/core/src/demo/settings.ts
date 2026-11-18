import { loadConfig } from '../config';
import { examCooldownSeconds, experimentDelaySeconds, nodeCooldownSeconds } from '../time';

export interface DemoSettings {
  timeScale: number;
  /** Real and scaled length of each pause, in seconds (D-32). */
  pauses: { key: 'node' | 'exam' | 'experiment'; realSeconds: number; scaledSeconds: number }[];
}

/** NFR-6: what TIME_SCALE does to the pauses right now, for the admin's demo page. */
export function demoSettings(config = loadConfig()): DemoSettings {
  return {
    timeScale: config.timeScale,
    pauses: [
      {
        key: 'node',
        realSeconds: config.node.cooldownSeconds,
        scaledSeconds: nodeCooldownSeconds(config),
      },
      {
        key: 'exam',
        realSeconds: config.exam.cooldownSeconds,
        scaledSeconds: examCooldownSeconds(config),
      },
      {
        key: 'experiment',
        realSeconds: config.experiment.delaySeconds,
        scaledSeconds: experimentDelaySeconds(config),
      },
    ],
  };
}
