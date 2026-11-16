import { contentItems, type Db } from '@eduforge/db';
import type { TranscriptionClient } from '@eduforge/llm';
import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { CourseError } from '../courses/errors';
import { statVideo } from './storage';

/** True when a video is stored with us and nobody has supplied a transcript yet. */
export const needsTranscription = (item: {
  kind: string;
  videoStorageKey: string | null;
  transcriptText: string | null;
}) => item.kind === 'video' && !!item.videoStorageKey && (item.transcriptText ?? '').trim() === '';

/** Video items that still wait for an automatic transcript. */
export async function findUntranscribedItemIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.kind, 'video'),
        isNotNull(contentItems.videoStorageKey),
        or(isNull(contentItems.transcriptText), sql`btrim(${contentItems.transcriptText}) = ''`),
      ),
    )
    .orderBy(asc(contentItems.id));
  return rows.map((r) => r.id);
}

/**
 * Fills `transcript_text` with a Whisper transcript (F2-R3). An author's own transcript is never
 * replaced: the write only happens while the transcript is still empty. Returns the node to re-index.
 */
export async function transcribeItem(
  db: Db,
  transcriber: TranscriptionClient,
  storageDir: string,
  contentItemId: string,
): Promise<{ transcribed: boolean; nodeId?: string }> {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, contentItemId));
  if (!item || !needsTranscription(item)) return { transcribed: false };

  const { path } = await statVideo(storageDir, item.videoStorageKey!).catch((err) => {
    throw err instanceof CourseError
      ? new Error(`Video file ${item.videoStorageKey} is missing`)
      : err;
  });
  const { text } = await transcriber.transcribe(path, { type: 'content_item', id: item.id });
  if (text.trim() === '') throw new Error('Transcription came back empty');

  const [row] = await db
    .update(contentItems)
    .set({ transcriptText: text.trim(), transcriptSource: 'whisper', updatedAt: new Date() })
    .where(
      and(
        eq(contentItems.id, item.id),
        or(isNull(contentItems.transcriptText), sql`btrim(${contentItems.transcriptText}) = ''`),
      ),
    )
    .returning({ nodeId: contentItems.nodeId });
  return row ? { transcribed: true, nodeId: row.nodeId } : { transcribed: false };
}
