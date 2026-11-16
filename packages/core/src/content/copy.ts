import { randomUUID } from 'node:crypto';
import { contentChunks, contentItems } from '@eduforge/db';
import { inArray } from 'drizzle-orm';
import type { Tx } from '../courses/service';

/**
 * Copies the content of the old nodes to the new ones (`nodeIds`: old id -> new id), chunks and
 * embeddings included, so a new version is searchable without re-embedding. Uploaded videos are shared.
 */
export async function copyContent(tx: Tx, nodeIds: Map<string, string>) {
  const oldNodeIds = [...nodeIds.keys()];
  if (oldNodeIds.length === 0) return;
  const items = await tx
    .select()
    .from(contentItems)
    .where(inArray(contentItems.nodeId, oldNodeIds));
  if (items.length === 0) return;
  const itemIds = new Map(items.map((i) => [i.id, randomUUID()]));

  await tx
    .insert(contentItems)
    .values(items.map((i) => ({ ...i, id: itemIds.get(i.id)!, nodeId: nodeIds.get(i.nodeId)! })));
  const chunks = await tx
    .select()
    .from(contentChunks)
    .where(inArray(contentChunks.contentItemId, [...itemIds.keys()]));
  // Batches keep a large course under the driver's parameter limit.
  for (let i = 0; i < chunks.length; i += 200) {
    await tx.insert(contentChunks).values(
      chunks.slice(i, i + 200).map((c) => ({
        ...c,
        id: randomUUID(),
        nodeId: nodeIds.get(c.nodeId)!,
        contentItemId: itemIds.get(c.contentItemId)!,
      })),
    );
  }
}
