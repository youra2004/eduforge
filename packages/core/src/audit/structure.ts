import { contentItems, nodes, type Db } from '@eduforge/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { CourseIssue } from '../courses/graph';
import { validateGraph } from '../courses/graph';
import { loadGraph } from '../courses/service';
import { contentIssues } from '../content/validation';
import { poolIssues, type PoolMinimums } from '../questions/pools';

/** F1-R3: every node has at least one content item. (`contentIssues` covers transcripts, `poolIssues` the questions.) */
async function emptyNodeIssues(db: Db, versionId: string): Promise<CourseIssue[]> {
  const rows = await db
    .select({
      id: nodes.id,
      title: nodes.title,
      items: sql<number>`count(${contentItems.id})::int`,
    })
    .from(nodes)
    .leftJoin(contentItems, eq(contentItems.nodeId, nodes.id))
    .where(eq(nodes.courseVersionId, versionId))
    .groupBy(nodes.id, nodes.title)
    .orderBy(asc(nodes.title));
  return rows
    .filter((r) => r.items === 0)
    .map((r) => ({
      code: 'node_without_content' as const,
      message: `Node "${r.title}" has no content.`,
      nodeIds: [r.id],
    }));
}

/** Stage 0 (F4-R1): the deterministic checks that must pass before any LLM is asked. Empty list = the version is ready for the audit. */
export async function structureIssues(
  db: Db,
  versionId: string,
  pools: PoolMinimums,
): Promise<{ issues: CourseIssue[]; nodeCount: number }> {
  const graph = await loadGraph(db, versionId);
  const issues = [
    ...validateGraph(graph),
    ...(graph.nodes.length === 0 ? [] : await emptyNodeIssues(db, versionId)),
    ...(await contentIssues(db, versionId)),
    ...(graph.nodes.length === 0 ? [] : await poolIssues(db, versionId, pools)),
  ];
  return { issues, nodeCount: graph.nodes.length };
}
