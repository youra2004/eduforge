import type { PgBoss } from 'pg-boss';
import { purgeExpiredEvidence } from '@eduforge/core';
import type { Db } from '@eduforge/db';

export const EVIDENCE_RETENTION_QUEUE = 'proctor.retention';

export interface ProctorJobDeps {
  db: Db;
  storageDir: string;
}

/** Daily (03:00) deletion of evidence frames past their `expires_at`, files included (F9-R7, DATA_MODEL §14). */
export async function registerProctorJobs(boss: PgBoss, deps: ProctorJobDeps) {
  await boss.createQueue(EVIDENCE_RETENTION_QUEUE, {
    policy: 'short',
    retryLimit: 3,
    retryDelay: 60,
  });
  await boss.work(EVIDENCE_RETENTION_QUEUE, { pollingIntervalSeconds: 5 }, async () => {
    const removed = await purgeExpiredEvidence(deps.db, deps.storageDir);
    console.log(`[proctor.retention] removed ${removed} expired evidence frames`);
  });
  await boss.schedule(EVIDENCE_RETENTION_QUEUE, '0 3 * * *');
  // Once at start as well, so a worker that was down at 03:00 catches up.
  await boss.send(EVIDENCE_RETENTION_QUEUE, {}, { singletonKey: 'startup' });
}
