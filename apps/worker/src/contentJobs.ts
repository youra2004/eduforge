import type { PgBoss } from 'pg-boss';
import {
  findStaleNodeIds,
  findUntranscribedItemIds,
  indexNode,
  INDEX_NODE_QUEUE,
  RECONCILE_QUEUE,
  transcribeItem,
  TRANSCRIBE_QUEUE,
  type IndexNodeJob,
  type TranscribeJob,
} from '@eduforge/core';
import type { Db } from '@eduforge/db';
import type { EmbeddingClient, TranscriptionClient } from '@eduforge/llm';

export interface ContentJobDeps {
  db: Db;
  embedder: EmbeddingClient;
  transcriber: TranscriptionClient;
  storageDir: string;
}

// `short`: at most one waiting job per key, so ten quick saves of one node make one index run.
const queueOptions = { policy: 'short', retryLimit: 3, retryDelay: 5 } as const;

export const enqueueIndexNode = (boss: PgBoss, nodeId: string) =>
  boss.send(INDEX_NODE_QUEUE, { nodeId } satisfies IndexNodeJob, { singletonKey: nodeId });

export const enqueueTranscribe = (boss: PgBoss, contentItemId: string) =>
  boss.send(TRANSCRIBE_QUEUE, { contentItemId } satisfies TranscribeJob, {
    singletonKey: contentItemId,
  });

/**
 * Re-queues work the web app may have failed to queue (for example while the worker was down):
 * nodes whose chunks are out of date and videos still waiting for a transcript. Safe to run any
 * time, since both jobs do nothing when there is nothing to do.
 */
export async function reconcileContent(boss: PgBoss, { db }: Pick<ContentJobDeps, 'db'>) {
  const [nodes, items] = await Promise.all([findStaleNodeIds(db), findUntranscribedItemIds(db)]);
  await Promise.all([
    ...nodes.map((id) => enqueueIndexNode(boss, id)),
    ...items.map((id) => enqueueTranscribe(boss, id)),
  ]);
  return { nodes: nodes.length, items: items.length };
}

export async function registerContentJobs(boss: PgBoss, deps: ContentJobDeps) {
  await boss.createQueue(INDEX_NODE_QUEUE, queueOptions);
  await boss.createQueue(TRANSCRIBE_QUEUE, queueOptions);
  await boss.createQueue(RECONCILE_QUEUE);

  await boss.work<IndexNodeJob>(INDEX_NODE_QUEUE, { pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return;
    const r = await indexNode(deps.db, deps.embedder, job.data.nodeId);
    console.log(`[content.index-node] ${job.data.nodeId}`, r);
  });

  await boss.work<TranscribeJob>(TRANSCRIBE_QUEUE, { pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return;
    const r = await transcribeItem(
      deps.db,
      deps.transcriber,
      deps.storageDir,
      job.data.contentItemId,
    );
    console.log(`[content.transcribe] ${job.data.contentItemId}`, r);
    // The new transcript is text to search: index it.
    if (r.transcribed && r.nodeId) await enqueueIndexNode(boss, r.nodeId);
  });

  await boss.work(RECONCILE_QUEUE, { pollingIntervalSeconds: 30 }, async () => {
    const r = await reconcileContent(boss, deps);
    if (r.nodes + r.items > 0) console.log('[content.reconcile]', r);
  });
  await boss.schedule(RECONCILE_QUEUE, '* * * * *');
  await reconcileContent(boss, deps);
}
