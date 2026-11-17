import {
  contentChunks,
  contentItems,
  courseVersions,
  nodeEdges,
  nodes,
  nodeSkills,
  questions,
  skills,
  staticHints,
  type Db,
} from '@eduforge/db';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { AuthError, type AuthUser } from '../auth/guard';
import { CourseError } from './errors';
import { validateGraph, type CourseIssue } from './graph';
import { canEdit, EDITABLE_STATUSES, loadGraph, loadVersion, type Tx } from './service';

const text = (max: number) => z.string().trim().max(max);
const id = z.uuid();
const position = z.object({ x: z.number().finite(), y: z.number().finite() });

/** One change made in the graph editor. Every change goes through `editGraph`, the same guard as every other edit (ADR-0005). */
export const graphEdit = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    title: text(200).min(1),
    summary: text(2000).default(''),
    skillIds: z.array(id).max(50).default([]),
    position: position.optional(),
  }),
  z.object({
    op: z.literal('update_node'),
    nodeId: id,
    title: text(200).min(1).optional(),
    summary: text(2000).optional(),
    skillIds: z.array(id).max(50).optional(),
    position: position.nullable().optional(),
  }),
  z.object({ op: z.literal('delete_node'), nodeId: id }),
  z.object({ op: z.literal('add_edge'), from: id, to: id }),
  z.object({ op: z.literal('delete_edge'), from: id, to: id }),
  z.object({
    op: z.literal('add_skill'),
    name: text(200).min(1),
    description: text(2000).default(''),
  }),
  z.object({
    op: z.literal('update_skill'),
    skillId: id,
    name: text(200).min(1).optional(),
    description: text(2000).optional(),
  }),
  z.object({ op: z.literal('delete_skill'), skillId: id }),
]);

export type GraphEdit = z.input<typeof graphEdit>;

const refuse = (message: string, extra: Partial<CourseIssue> = {}) =>
  new CourseError('invalid_graph_edit', [{ code: 'schema', message, ...extra }]);

/** Every id in `wanted` must be one of this version's `known` ids. */
function assertOwn(known: string[], wanted: string[], what: string) {
  const own = new Set(known);
  if (wanted.some((w) => !own.has(w))) throw refuse(`Unknown ${what} for this version.`);
}

async function setNodeSkills(tx: Tx, nodeId: string, skillIds: string[]) {
  await tx.delete(nodeSkills).where(eq(nodeSkills.nodeId, nodeId));
  const unique = [...new Set(skillIds)];
  if (unique.length > 0) {
    await tx.insert(nodeSkills).values(unique.map((skillId) => ({ nodeId, skillId })));
  }
}

async function apply(tx: Tx, versionId: string, edit: z.output<typeof graphEdit>) {
  const graph = await loadGraph(tx, versionId);
  const nodeIds = graph.nodes.map((n) => n.id);
  const skillIds = graph.skills.map((s) => s.id);

  switch (edit.op) {
    case 'add_node': {
      assertOwn(skillIds, edit.skillIds, 'skill');
      const [row] = await tx
        .insert(nodes)
        .values({
          courseVersionId: versionId,
          title: edit.title,
          summary: edit.summary,
          position: edit.position,
        })
        .returning({ id: nodes.id });
      await setNodeSkills(tx, row!.id, edit.skillIds);
      return { nodeId: row!.id };
    }
    case 'update_node': {
      assertOwn(nodeIds, [edit.nodeId], 'node');
      const patch: Partial<typeof nodes.$inferInsert> = {};
      if (edit.title !== undefined) patch.title = edit.title;
      if (edit.summary !== undefined) patch.summary = edit.summary;
      if (edit.position !== undefined) patch.position = edit.position;
      if (Object.keys(patch).length > 0) {
        await tx.update(nodes).set(patch).where(eq(nodes.id, edit.nodeId));
      }
      if (edit.skillIds) {
        assertOwn(skillIds, edit.skillIds, 'skill');
        await setNodeSkills(tx, edit.nodeId, edit.skillIds);
      }
      return {};
    }
    case 'delete_node': {
      assertOwn(nodeIds, [edit.nodeId], 'node');
      // The node's own material goes with it: hints, chunks, content, questions, links.
      await tx.delete(staticHints).where(eq(staticHints.nodeId, edit.nodeId));
      await tx.delete(contentChunks).where(eq(contentChunks.nodeId, edit.nodeId));
      await tx.delete(contentItems).where(eq(contentItems.nodeId, edit.nodeId));
      await tx.delete(questions).where(eq(questions.nodeId, edit.nodeId));
      await tx.delete(nodeSkills).where(eq(nodeSkills.nodeId, edit.nodeId));
      await tx
        .delete(nodeEdges)
        .where(or(eq(nodeEdges.nodeId, edit.nodeId), eq(nodeEdges.prereqNodeId, edit.nodeId)));
      await tx.delete(nodes).where(eq(nodes.id, edit.nodeId));
      return {};
    }
    case 'add_edge': {
      assertOwn(nodeIds, [edit.from, edit.to], 'node');
      if (edit.from === edit.to) throw refuse('A node cannot be its own prerequisite.');
      if (graph.edges.some((e) => e.from === edit.from && e.to === edit.to)) {
        throw refuse('This prerequisite already exists.');
      }
      // Other problems (isolated nodes...) may be fixed by the next edit; only a cycle is refused at once.
      const cycle = validateGraph({
        nodes: graph.nodes,
        edges: [...graph.edges, { from: edit.from, to: edit.to }],
      }).find((i) => i.code === 'cycle');
      if (cycle) throw new CourseError('invalid_graph_edit', [cycle]);
      await tx.insert(nodeEdges).values({ prereqNodeId: edit.from, nodeId: edit.to });
      return {};
    }
    case 'delete_edge': {
      assertOwn(nodeIds, [edit.from, edit.to], 'node');
      await tx
        .delete(nodeEdges)
        .where(and(eq(nodeEdges.prereqNodeId, edit.from), eq(nodeEdges.nodeId, edit.to)));
      return {};
    }
    case 'add_skill': {
      const [row] = await tx
        .insert(skills)
        .values({ courseVersionId: versionId, name: edit.name, description: edit.description })
        .returning({ id: skills.id });
      return { skillId: row!.id };
    }
    case 'update_skill': {
      assertOwn(skillIds, [edit.skillId], 'skill');
      const patch: Partial<typeof skills.$inferInsert> = {};
      if (edit.name !== undefined) patch.name = edit.name;
      if (edit.description !== undefined) patch.description = edit.description;
      // The text changed, so an earlier audit verdict no longer applies.
      if (Object.keys(patch).length > 0) {
        await tx
          .update(skills)
          .set({ ...patch, verified: null, verificationNote: null })
          .where(eq(skills.id, edit.skillId));
      }
      return {};
    }
    case 'delete_skill': {
      assertOwn(skillIds, [edit.skillId], 'skill');
      const [used] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.skillId, edit.skillId))
        .limit(1);
      if (used) throw refuse('This skill still has questions. Remove them first.');
      await tx.delete(nodeSkills).where(eq(nodeSkills.skillId, edit.skillId));
      await tx.delete(skills).where(eq(skills.id, edit.skillId));
      return {};
    }
  }
}

/**
 * Applies one editor change to an editable version. The version row is share-locked after the permission check, so a
 * status change (a submit for audit) cannot slip in between the check and the write (D-06).
 */
export async function editGraph(db: Db, user: AuthUser | null, versionId: string, input: unknown) {
  const parsed = graphEdit.safeParse(input);
  const { course, user: actor } = await loadVersion(db, user, versionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  if (!parsed.success) {
    throw new CourseError(
      'invalid_graph_edit',
      parsed.error.issues.map((i) => ({
        code: 'schema' as const,
        message: i.message,
        path: i.path.join('.'),
      })),
    );
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: courseVersions.status })
      .from(courseVersions)
      .where(eq(courseVersions.id, versionId))
      .for('share');
    if (!locked || !EDITABLE_STATUSES.includes(locked.status)) {
      throw new CourseError('version_locked');
    }
    return apply(tx, versionId, parsed.data);
  });
}
