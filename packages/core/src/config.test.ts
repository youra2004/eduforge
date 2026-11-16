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

  it('treats blank values as unset and rejects out-of-range ones', () => {
    const c = loadConfig({ ...base, TIME_SCALE: '', NODE_COOLDOWN_SECONDS: '' });
    expect(c.timeScale).toBe(1);
    expect(c.node.cooldownSeconds).toBe(86400);
    expect(() => loadConfig({ ...base, NODE_PASS_THRESHOLD: '5' })).toThrow(/NODE_PASS_THRESHOLD/);
    expect(() => loadConfig({ ...base, EXAM_COOLDOWN_SECONDS: '-10' })).toThrow(
      /EXAM_COOLDOWN_SECONDS/,
    );
  });

  it('defaults providers to the mock and needs a key only for openai', () => {
    const c = loadConfig(base);
    expect(c.embedding).toEqual({ provider: 'mock', model: 'text-embedding-3-large' });
    expect(c.transcription.provider).toBe('mock');
    expect(c.storageDir).toMatch(/\.eduforge[\\/]storage$/);
    expect(() => loadConfig({ ...base, EMBEDDING_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(
      loadConfig({ ...base, EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }).embedding.provider,
    ).toBe('openai');
  });

  it('requires an absolute STORAGE_DIR', () => {
    expect(() => loadConfig({ ...base, STORAGE_DIR: 'relative/dir' })).toThrow(/STORAGE_DIR/);
    expect(loadConfig({ ...base, STORAGE_DIR: '/var/eduforge' }).storageDir).toBe('/var/eduforge');
  });
});
