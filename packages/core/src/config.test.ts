import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgres://x' };

describe('loadConfig', () => {
  it('applies SPEC defaults', () => {
    const c = loadConfig(base);
    expect(c.timeScale).toBe(1);
    expect(c.node).toEqual({ passThreshold: 0.8, attemptsPerRound: 2, cooldownSeconds: 86400 });
    expect(c.bkt).toEqual({ pInit: 0.2, learn: 0.15, slip: 0.1 });
    expect(c.exam.passPct).toBe(0.7);
    expect(c.exam.cooldownSeconds).toBe(7 * 86400);
    expect(c.proctoring.snapshotIntervalSeconds).toBe(60);
    expect(c.embeddingDim).toBe(1024);
  });

  it('reads overrides from env strings', () => {
    const c = loadConfig({ ...base, TIME_SCALE: '1440', EMBEDDING_DIM: '768' });
    expect(c.timeScale).toBe(1440);
    expect(c.embeddingDim).toBe(768);
  });

  it('rejects a missing DATABASE_URL and a non-positive TIME_SCALE', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, TIME_SCALE: '0' })).toThrow(/TIME_SCALE/);
    expect(() => loadConfig({ ...base, TIME_SCALE: 'abc' })).toThrow(/TIME_SCALE/);
  });
});
