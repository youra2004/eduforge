import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { examCooldownSeconds, nodeCooldownSeconds } from './time';

const env = { DATABASE_URL: 'postgres://x' };

describe('TIME_SCALE', () => {
  it('leaves the node pause at 24 h when TIME_SCALE=1', () => {
    expect(nodeCooldownSeconds(loadConfig(env))).toBe(86400);
  });

  it('compresses the node pause: 24 h at TIME_SCALE=1440 is 60 s', () => {
    expect(nodeCooldownSeconds(loadConfig({ ...env, TIME_SCALE: '1440' }))).toBe(60);
  });

  it('compresses the exam pause: 7 days at TIME_SCALE=10080 is 60 s', () => {
    expect(examCooldownSeconds(loadConfig({ ...env, TIME_SCALE: '10080' }))).toBe(60);
  });
});
