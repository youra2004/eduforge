import { PgBoss } from 'pg-boss';
import {
  INDEX_NODE_QUEUE,
  loadConfig,
  needsTranscription,
  TRANSCRIBE_QUEUE,
  type IndexNodeJob,
  type TranscribeJob,
} from '@eduforge/core';
import type { ContentItem } from '@eduforge/db';

const globalForBoss = globalThis as unknown as { eduforgeBoss?: Promise<PgBoss> };

/** A send-only pg-boss: the worker owns the schema, the queues and the job handlers. */
function getBoss() {
  globalForBoss.eduforgeBoss ??= (async () => {
    const boss = new PgBoss({
      connectionString: loadConfig().databaseUrl,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => console.error('[web] pg-boss error', err));
    try {
      await boss.start();
    } catch (err) {
      globalForBoss.eduforgeBoss = undefined; // try again on the next request
      throw err;
    }
    return boss;
  })();
  return globalForBoss.eduforgeBoss;
}

/**
 * Asks the worker to index the item's node and, for an uploaded video without a transcript, to
 * transcribe it. Saving content must not fail because the queue is down, so errors are only logged:
 * the worker's sweep queues whatever was missed once it is running.
 */
export async function queueContentWork(
  item: Pick<ContentItem, 'id' | 'nodeId' | 'kind' | 'videoStorageKey' | 'transcriptText'>,
) {
  try {
    const boss = await getBoss();
    await boss.send(INDEX_NODE_QUEUE, { nodeId: item.nodeId } satisfies IndexNodeJob, {
      singletonKey: item.nodeId,
    });
    if (needsTranscription(item)) {
      await boss.send(TRANSCRIBE_QUEUE, { contentItemId: item.id } satisfies TranscribeJob, {
        singletonKey: item.id,
      });
    }
  } catch (err) {
    console.error('[web] could not queue content work; the worker will pick it up later', err);
  }
}
