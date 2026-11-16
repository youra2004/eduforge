import { contentChunks, type Db } from '@eduforge/db';
import type { EmbeddingClient } from '@eduforge/llm';
import { cosineDistance, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

const retrieveInput = z.object({
  allowedNodeIds: z.array(z.uuid()),
  query: z.string().trim().min(1),
  k: z.number().int().min(1).max(50),
});

export type RetrieveInput = z.input<typeof retrieveInput>;

export interface RetrievedChunk {
  chunkId: string;
  nodeId: string;
  contentItemId: string;
  chunkIndex: number;
  text: string;
  /** Cosine similarity, higher is closer. */
  score: number;
}

/**
 * The nearest chunks to `query` among the chunks of `allowedNodeIds` only (D-15). The node filter is
 * part of the SQL, never of the prompt, so no other node's text can come back. An empty list returns nothing.
 */
export async function retrieve(
  db: Db,
  embedder: EmbeddingClient,
  input: RetrieveInput,
): Promise<RetrievedChunk[]> {
  const { allowedNodeIds, query, k } = retrieveInput.parse(input);
  if (allowedNodeIds.length === 0) return [];

  const {
    vectors: [vector],
  } = await embedder.embed([query]);
  const distance = cosineDistance(contentChunks.embedding, vector!);

  const rows = await db
    .select({
      chunkId: contentChunks.id,
      nodeId: contentChunks.nodeId,
      contentItemId: contentChunks.contentItemId,
      chunkIndex: contentChunks.chunkIndex,
      text: contentChunks.text,
      distance,
    })
    .from(contentChunks)
    .where(inArray(contentChunks.nodeId, allowedNodeIds))
    // `+ 0` keeps Postgres from walking the approximate HNSW index and filtering afterwards, which
    // can miss allowed chunks (it only looks at its nearest candidates). The allowed set is small
    // (a node and its passed prerequisites), so it is scanned through the node_id index, exactly.
    .orderBy(sql`(${distance}) + 0`)
    .limit(k);
  return rows.map(({ distance: d, ...row }) => ({ ...row, score: 1 - Number(d) }));
}
