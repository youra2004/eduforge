import { contentItems, nodes, type Db } from '@eduforge/db';
import { and, asc, eq } from 'drizzle-orm';
import type { CourseIssue } from '../courses/graph';

/** F2-R3: a video lesson without a transcript cannot be published. */
export async function contentIssues(db: Db, versionId: string): Promise<CourseIssue[]> {
  const items = await db
    .select({
      nodeId: contentItems.nodeId,
      title: contentItems.title,
      transcript: contentItems.transcriptText,
    })
    .from(contentItems)
    .innerJoin(nodes, eq(nodes.id, contentItems.nodeId))
    .where(and(eq(nodes.courseVersionId, versionId), eq(contentItems.kind, 'video')))
    .orderBy(asc(contentItems.title));
  return items
    .filter((i) => (i.transcript ?? '').trim() === '')
    .map((i) => ({
      code: 'video_without_transcript' as const,
      message: `Video "${i.title}" has no transcript.`,
      nodeIds: [i.nodeId],
    }));
}
