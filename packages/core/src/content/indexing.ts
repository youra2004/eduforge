import { createHash } from 'node:crypto';
import { contentChunks, contentItems, type ContentItem, type Db } from '@eduforge/db';
import type { EmbeddingClient } from '@eduforge/llm';
import { asc, eq } from 'drizzle-orm';
import { chunkText } from './chunking';

type IndexableItem = Pick<ContentItem, 'kind' | 'title' | 'bodyMd' | 'transcriptText'>;

/**
 * The text a content item contributes to search: markdown body, or the transcript of a video
 * (F2-R3: RAG works from the transcript). Empty when there is nothing to index yet.
 */
export function indexableText(item: IndexableItem): string {
  const body = (item.kind === 'markdown' ? item.bodyMd : item.transcriptText)?.trim() ?? '';
  return body === '' ? '' : `# ${item.title}\n\n${body}`;
}

export const textHash = (text: string) => createHash('sha256').update(text).digest('hex');

/** The hash recorded in `indexed_hash` once the item is indexed; null when there is nothing to index. */
const wantedHash = (item: IndexableItem) => {
  const text = indexableText(item);
  return text === '' ? null : textHash(text);
};

export interface IndexResult {
  indexed: number;
  skipped: number;
  chunks: number;
}

/**
 * Brings the chunks of one content item in line with its text. Does nothing (and makes no embedding
 * call) when the text is unchanged, so re-running is safe and cheap.
 */
async function indexItem(db: Db, embedder: EmbeddingClient, item: ContentItem) {
  const hash = wantedHash(item);
  if (hash === item.indexedHash) return { done: false, chunks: 0 };

  const chunks = hash ? chunkText(indexableText(item)) : [];
  const vectors = chunks.length
    ? (
        await embedder.embed(
          chunks.map((c) => c.text),
          { type: 'content_item', id: item.id },
        )
      ).vectors
    : [];

  return db.transaction(async (tx) => {
    // Lock the row so two jobs for one node cannot interleave their delete and insert.
    const [current] = await tx
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, item.id))
      .for('update');
    // Deleted, or edited since we read it: a newer index job is on its way for that text.
    if (!current || wantedHash(current) !== hash) return { done: false, chunks: 0 };
    if (current.indexedHash === hash) return { done: false, chunks: 0 };

    await tx.delete(contentChunks).where(eq(contentChunks.contentItemId, item.id));
    if (chunks.length > 0) {
      await tx.insert(contentChunks).values(
        chunks.map((c, i) => ({
          nodeId: item.nodeId,
          contentItemId: item.id,
          chunkIndex: i,
          text: c.text,
          tokenCount: c.tokenCount,
          embedding: vectors[i]!,
        })),
      );
    }
    await tx.update(contentItems).set({ indexedHash: hash }).where(eq(contentItems.id, item.id));
    return { done: true, chunks: chunks.length };
  });
}

/** Indexes every item of one node that changed since it was last indexed; the other nodes are not touched. */
export async function indexNode(db: Db, embedder: EmbeddingClient, nodeId: string) {
  const items = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.nodeId, nodeId))
    .orderBy(asc(contentItems.ord), asc(contentItems.id));
  const result: IndexResult = { indexed: 0, skipped: 0, chunks: 0 };
  for (const item of items) {
    const r = await indexItem(db, embedder, item);
    if (r.done) {
      result.indexed++;
      result.chunks += r.chunks;
    } else {
      result.skipped++;
    }
  }
  return result;
}

/** Nodes with at least one item whose chunks are out of date. The worker sweeps these, so a lost job heals itself. */
export async function findStaleNodeIds(db: Db): Promise<string[]> {
  const items = await db.select().from(contentItems);
  return [...new Set(items.filter((i) => wantedHash(i) !== i.indexedHash).map((i) => i.nodeId))];
}
