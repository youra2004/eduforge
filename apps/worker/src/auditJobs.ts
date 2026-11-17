import type { PgBoss } from 'pg-boss';
import {
  AUDIT_QUEUE,
  auditSettings,
  failAudit,
  findAuditingJobs,
  runAudit,
  type AuditJob,
  type AuditSettings,
} from '@eduforge/core';
import type { Db } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';

export interface AuditJobDeps {
  db: Db;
  llm: LLMClient;
  settings?: AuditSettings;
  /** Seconds before a failed run is retried (tests shorten it). */
  retryDelay?: number;
}

// One waiting job per version and attempt. An LLM failure is retried a few times; then the run is given back.
const RETRY_LIMIT = 3;

export const enqueueAudit = (boss: PgBoss, job: AuditJob) =>
  boss.send(AUDIT_QUEUE, job, { singletonKey: `${job.versionId}:${job.attemptNo}` });

/** Queues every audit that was started but never finished (for example the worker was down when it was submitted). */
export async function requeueAudits(boss: PgBoss, { db }: Pick<AuditJobDeps, 'db'>) {
  const jobs = await findAuditingJobs(db);
  await Promise.all(jobs.map((job) => enqueueAudit(boss, job)));
  return jobs.length;
}

export async function registerAuditJobs(boss: PgBoss, deps: AuditJobDeps) {
  await boss.createQueue(AUDIT_QUEUE, {
    policy: 'short',
    retryLimit: RETRY_LIMIT,
    retryDelay: deps.retryDelay ?? 10,
  });
  const settings = deps.settings ?? auditSettings();

  await boss.work<AuditJob>(AUDIT_QUEUE, { pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return;
    try {
      const r = await runAudit(deps.db, deps.llm, job.data, settings);
      console.log(`[audit.run] ${job.data.versionId} #${job.data.attemptNo}`, r);
    } catch (err) {
      if (job.retryCount < RETRY_LIMIT) throw err; // pg-boss retries
      console.error(`[audit.run] giving up on ${job.data.versionId}`, err);
      await failAudit(deps.db, job.data);
    }
  });

  const waiting = await requeueAudits(boss, deps);
  if (waiting > 0) console.log(`[audit] re-queued ${waiting} unfinished audits`);
}
