import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkHealth } from '@eduforge/db';
import { registerJobs, SAMPLE_QUEUE, type SampleJobData } from './jobs';

const url = process.env.TEST_DATABASE_URL!;
const boss = new PgBoss(url);
const done: SampleJobData[] = [];

beforeAll(async () => {
  await boss.start();
  await registerJobs(boss, (data) => done.push(data));
});
afterAll(() => boss.stop());

async function waitFor(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for job');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('worker sample job', () => {
  it('runs a job to completion', async () => {
    await boss.send(SAMPLE_QUEUE, { message: 'ok' });
    await waitFor(() => done.some((d) => d.message === 'ok'));
  });

  it('retries a failing job until it succeeds', async () => {
    const id = await boss.send(SAMPLE_QUEUE, { message: 'flaky', failUntilRetry: 2 });
    await waitFor(() => done.some((d) => d.message === 'flaky'));
    const job = await boss.getJobById(SAMPLE_QUEUE, id!);
    expect(job?.retryCount).toBe(2);
    expect(job?.state).toBe('completed');
  });
});

describe('health', () => {
  it('reports db and queue ok once pg-boss is installed', async () => {
    expect(await checkHealth(url)).toEqual({ ok: true, db: { ok: true }, queue: { ok: true } });
  });

  it('reports db down for an unreachable database', async () => {
    const health = await checkHealth('postgres://eduforge:eduforge@localhost:1/none');
    expect(health.ok).toBe(false);
    expect(health.db.ok).toBe(false);
  });
});
