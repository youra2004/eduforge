import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { NewLLMRun } from '@eduforge/db';
import { LLMClient } from './client';
import { MockLLMProvider } from './mock';
import type { LLMRunStore } from './store';

class MemoryStore implements LLMRunStore {
  rows: NewLLMRun[] = [];
  async insert(run: NewLLMRun) {
    this.rows.push(run);
    return `run-${this.rows.length}`;
  }
}

const schema = z.object({ score: z.number().min(0).max(1) });
const req = {
  purpose: 'audit_scoring' as const,
  promptVersion: 'v1',
  prompt: 'rate this',
  schema,
};

function setup(output: unknown = { score: 0.5 }) {
  const provider = new MockLLMProvider({ audit_scoring: () => output });
  const store = new MemoryStore();
  return { provider, store, client: new LLMClient(provider, store) };
}

describe('LLMClient', () => {
  it('returns schema-validated data and logs a run', async () => {
    const { client, store } = setup();
    const res = await client.generate(req);
    expect(res).toMatchObject({ data: { score: 0.5 }, cached: false, runId: 'run-1' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ purpose: 'audit_scoring', model: 'mock-1' });
  });

  it('serves an identical request from cache without calling the provider', async () => {
    const { client, provider, store } = setup();
    await client.generate(req);
    const second = await client.generate(req);
    expect(second.cached).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]?.params).toMatchObject({ cached: true });
  });

  it('misses the cache when the prompt or prompt version changes', async () => {
    const { client, provider } = setup();
    await client.generate(req);
    await client.generate({ ...req, prompt: 'rate that' });
    await client.generate({ ...req, promptVersion: 'v2' });
    expect(provider.calls).toHaveLength(3);
  });

  it('bypasses the cache when cache is false', async () => {
    const { client, provider } = setup();
    await client.generate({ ...req, cache: false });
    await client.generate({ ...req, cache: false });
    expect(provider.calls).toHaveLength(2);
  });

  it('rejects output that fails the schema, logs the raw output, and does not cache it', async () => {
    const { client, store, provider } = setup({ score: 7 });
    await expect(client.generate(req)).rejects.toThrow(/schema validation/);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.response).toEqual({ raw: { score: 7 } });
    await expect(client.generate(req)).rejects.toThrow();
    expect(provider.calls).toHaveLength(2);
  });

  it('logs a run when the provider throws, then rethrows', async () => {
    const store = new MemoryStore();
    const client = new LLMClient(new MockLLMProvider({}), store);
    await expect(client.generate(req)).rejects.toThrow(/no responder/);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.response).toBeNull();
    expect(store.rows[0]?.params).toMatchObject({
      providerError: expect.stringContaining('no responder'),
    });
  });
});
