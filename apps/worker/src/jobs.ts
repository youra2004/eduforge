import type { PgBoss } from 'pg-boss';

export const SAMPLE_QUEUE = 'sample.echo';

export interface SampleJobData {
  message: string;
  /** Test hook: the job throws while retryCount < failUntilRetry, to prove retries work. */
  failUntilRetry?: number;
}

export const sampleJobRetry = { retryLimit: 3, retryDelay: 1 } as const;

/** Creates queues and registers handlers. Called by the worker and by integration tests. */
export async function registerJobs(boss: PgBoss, onDone?: (data: SampleJobData) => void) {
  await boss.createQueue(SAMPLE_QUEUE, sampleJobRetry);
  await boss.work<SampleJobData>(SAMPLE_QUEUE, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
    if (!job) return;
    const { failUntilRetry = 0 } = job.data;
    if (job.retryCount < failUntilRetry) {
      throw new Error(`sample job failing on attempt ${job.retryCount + 1}`);
    }
    console.log(`[sample.echo] ${job.data.message} (retryCount=${job.retryCount})`);
    onDone?.(job.data);
  });
}
