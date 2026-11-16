import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrate';

const url = process.env.TEST_DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url });
afterAll(() => pool.end());

async function exists(sql: string) {
  const res = await pool.query<{ found: boolean }>(`SELECT (${sql}) AS found`);
  return res.rows[0]?.found;
}
const hasVector = () => exists("EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')");
const hasLlmRuns = () => exists("to_regclass('public.llm_runs') IS NOT NULL");

describe('migrations', () => {
  it('apply to an empty DB: vector extension and llm_runs exist', async () => {
    expect(await hasVector()).toBe(true);
    expect(await hasLlmRuns()).toBe(true);
  });

  it('roll back, and apply again', async () => {
    const rolledBack = await migrateDown(url, 2);
    expect(rolledBack).toEqual(['0001_llm_runs', '0000_enable_vector']);
    expect(await hasLlmRuns()).toBe(false);
    expect(await hasVector()).toBe(false);

    await migrateUp(url);
    expect(await hasVector()).toBe(true);
    expect(await hasLlmRuns()).toBe(true);
  });
});
