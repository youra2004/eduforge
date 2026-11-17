import { randomUUID } from 'node:crypto';
import { questions } from '@eduforge/db';
import { and, inArray, ne } from 'drizzle-orm';
import type { Tx } from '../courses/service';

/**
 * Copies the questions of the old nodes to the new version (`nodeIds` and `skillIds`: old id -> new id) with their
 * status, key, metadata and run links, so a new version starts with the same validated pools.
 */
export async function copyQuestions(
  tx: Tx,
  nodeIds: Map<string, string>,
  skillIds: Map<string, string>,
) {
  const oldNodeIds = [...nodeIds.keys()];
  if (oldNodeIds.length === 0) return;
  // Questions still waiting for a verdict are left behind: nothing would queue their validation in the copy.
  const rows = await tx
    .select()
    .from(questions)
    .where(and(inArray(questions.nodeId, oldNodeIds), ne(questions.status, 'generated')));
  for (let i = 0; i < rows.length; i += 200) {
    await tx.insert(questions).values(
      rows.slice(i, i + 200).map((q) => ({
        ...q,
        id: randomUUID(),
        nodeId: nodeIds.get(q.nodeId)!,
        skillId: skillIds.get(q.skillId)!,
      })),
    );
  }
}
