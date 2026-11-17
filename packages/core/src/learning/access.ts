import { enrollments, nodeProgress, nodes, type Db, type NodeProgress } from '@eduforge/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { hasRole, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { canEdit, loadVersion, type Tx } from '../courses/service';
import { refreshCooldown } from './state';

/** The node's version, or `course_not_found` for a bad id; visibility is `loadVersion`'s call. */
export async function loadNodeContext(db: Db | Tx, user: AuthUser | null, nodeId: string) {
  const [row] = z.uuid().safeParse(nodeId).success
    ? await db.select({ versionId: nodes.courseVersionId }).from(nodes).where(eq(nodes.id, nodeId))
    : [];
  if (!row) throw new CourseError('course_not_found');
  return { nodeId, ...(await loadVersion(db, user, row.versionId)) };
}

export async function findProgress(db: Db | Tx, userId: string, nodeId: string) {
  const [row] = await db
    .select()
    .from(nodeProgress)
    .where(and(eq(nodeProgress.userId, userId), eq(nodeProgress.nodeId, nodeId)));
  return row;
}

export async function isEnrolled(db: Db | Tx, userId: string, versionId: string) {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseVersionId, versionId)));
  return !!row;
}

/** The progress row as the student sees it now: a finished pause already counts as `available`. */
export const currentProgress = (row: NodeProgress, now: Date) => ({
  ...row,
  ...refreshCooldown(row, now),
});

/**
 * P1 / F5-R5: the server decides who may open a node. The course's author, admins and experts may look at
 * everything (they review it); anyone else must be enrolled and the node must not be `locked`.
 * Throws `not_enrolled` or `node_locked`; a missing or invisible node is `course_not_found`.
 */
export async function assertNodeAccess(db: Db | Tx, user: AuthUser | null, nodeId: string) {
  const { version, course, user: actor } = await loadNodeContext(db, user, nodeId);
  if (canEdit(actor, course.authorId) || hasRole(actor, 'admin', 'expert'))
    return { actor, version };
  const progress = await findProgress(db, actor.id, nodeId);
  if (!progress) throw new CourseError('not_enrolled');
  if (progress.state === 'locked') throw new CourseError('node_locked');
  return { actor, version };
}
