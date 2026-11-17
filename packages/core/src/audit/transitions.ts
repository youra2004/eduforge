import { courseVersions, type Db, type VersionStatus } from '@eduforge/db';
import { and, eq, type SQL } from 'drizzle-orm';
import type { Tx } from '../courses/service';

/** F4: `draft → auditing → changes_requested | ready_to_publish | expert_review → published`, plus the author's ways back. */
export const versionTransitions: Record<VersionStatus, VersionStatus[]> = {
  draft: ['auditing'],
  auditing: ['changes_requested', 'ready_to_publish', 'expert_review'],
  // The author may keep editing a ready version to change the score before publishing (D-09).
  changes_requested: ['auditing'],
  ready_to_publish: ['published', 'draft'],
  // Approved → ready_to_publish; rejected → the author improves (changes_requested) or publishes with 9 (published).
  expert_review: ['ready_to_publish', 'changes_requested', 'published'],
  // Immutable for good (D-06): a change means a new version.
  published: ['archived'],
  archived: [],
};

export const canTransition = (from: VersionStatus, to: VersionStatus) =>
  versionTransitions[from].includes(to);

type VersionRow = typeof courseVersions.$inferInsert;
type VersionPatch = { [K in keyof VersionRow]?: VersionRow[K] | SQL };

/**
 * Moves a version from `from` to `to` in one guarded UPDATE: it matches only while the version still has status `from`
 * (and, optionally, `extra`), so concurrent actions cannot both succeed. Returns the row, or null when the guard failed.
 */
export async function moveVersion(
  db: Db | Tx,
  versionId: string,
  from: VersionStatus,
  to: VersionStatus,
  set: VersionPatch = {},
  extra?: SQL,
) {
  if (!canTransition(from, to)) throw new Error(`Version cannot move from ${from} to ${to}`);
  const [row] = await db
    .update(courseVersions)
    .set({ ...set, status: to })
    .where(and(eq(courseVersions.id, versionId), eq(courseVersions.status, from), extra))
    .returning();
  return row ?? null;
}
