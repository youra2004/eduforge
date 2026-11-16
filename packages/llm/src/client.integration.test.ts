import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDb, llmRuns } from '@eduforge/db';
import { LLMClient } from './client';
import { MockLLMProvider } from './mock';
import { DrizzleLLMRunStore } from './store';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

describe('LLMClient + Mock + llm_runs', () => {
  it('returns a Zod-validated result and writes a row to llm_runs', async () => {
    const client = new LLMClient(
      new MockLLMProvider({ tutor: () => ({ answer: 'hi' }) }),
      new DrizzleLLMRunStore(db),
    );
    const res = await client.generate({
      purpose: 'tutor',
      promptVersion: 'it-1',
      prompt: 'say hi',
      schema: z.object({ answer: z.string() }),
      params: { temperature: 0 },
    });
    expect(res.data).toEqual({ answer: 'hi' });

    const [row] = await db.select().from(llmRuns).where(eq(llmRuns.id, res.runId));
    expect(row).toMatchObject({
      purpose: 'tutor',
      model: 'mock-1',
      promptVersion: 'it-1',
      response: { answer: 'hi' },
    });
    expect(row?.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.params).toMatchObject({ temperature: 0, cached: false });
  });
});
