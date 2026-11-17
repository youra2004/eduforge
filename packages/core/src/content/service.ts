import { randomUUID } from 'node:crypto';
import {
  contentItems,
  courseVersions,
  courses,
  nodes,
  type ContentItem,
  type Db,
} from '@eduforge/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthError, hasRole, requireRole, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { canEdit, canView, EDITABLE_STATUSES, loadVersion } from '../courses/service';
import { assertNodeAccess } from '../learning/access';
import { statVideo, storageKeyPattern } from './storage';

const title = z.string().trim().min(1).max(200);
const videoUrl = z
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed.');
const storageKey = z.string().regex(storageKeyPattern);
const transcript = z.string().max(500_000);

const createInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('markdown'),
    title,
    bodyMd: z.string().max(200_000),
    ord: z.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal('video'),
    title,
    videoUrl: videoUrl.nullish(),
    videoStorageKey: storageKey.nullish(),
    transcriptText: transcript.nullish(),
    ord: z.number().int().min(0).optional(),
  }),
]);

const updateInput = z
  .object({
    title,
    bodyMd: z.string().max(200_000),
    videoUrl: videoUrl.nullable(),
    videoStorageKey: storageKey.nullable(),
    transcriptText: transcript.nullable(),
    ord: z.number().int().min(0),
  })
  .partial()
  .strict();

const invalid = (message: string, path?: string) =>
  new CourseError('invalid_content', [{ code: 'schema', message, path }]);

const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new CourseError(
    'invalid_content',
    parsed.error.issues.map((i) => ({
      code: 'schema' as const,
      message: i.message,
      path: i.path.join('.'),
    })),
  );
};

const blank = (s: string | null | undefined) => (s ?? '').trim() === '';

/** The item as the API shows it: everything but the index bookkeeping. */
function present({ indexedHash: _hash, ...item }: ContentItem) {
  return { ...item, indexed: _hash !== null };
}

async function loadNode(db: Db, user: AuthUser | null, nodeId: string) {
  const [row] = z.uuid().safeParse(nodeId).success
    ? await db.select({ versionId: nodes.courseVersionId }).from(nodes).where(eq(nodes.id, nodeId))
    : [];
  if (!row) throw new CourseError('course_not_found');
  return { nodeId, ...(await loadVersion(db, user, row.versionId)) };
}

/** A node's content items in order, with whether the caller may edit them. */
export async function listNodeContent(db: Db, user: AuthUser | null, nodeId: string) {
  const { version, course, user: actor } = await loadNode(db, user, nodeId);
  // A student reaches a node's material only when the node is not locked (F5-R5, P1).
  await assertNodeAccess(db, actor, nodeId);
  const items = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.nodeId, nodeId))
    .orderBy(asc(contentItems.ord), asc(contentItems.title), asc(contentItems.id));
  return {
    items: items.map(present),
    canEdit: canEdit(actor, course.authorId) && EDITABLE_STATUSES.includes(version.status),
  };
}

/**
 * Runs `write` with the version row share-locked after checking the caller may edit it, so a status
 * change (e.g. a submit for audit) cannot slip in between the check and the write (D-06).
 */
async function editNode<T>(
  db: Db,
  user: AuthUser | null,
  nodeId: string,
  write: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>,
) {
  const { version, course, user: actor } = await loadNode(db, user, nodeId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: courseVersions.status })
      .from(courseVersions)
      .where(eq(courseVersions.id, version.id))
      .for('share');
    if (!locked || !EDITABLE_STATUSES.includes(locked.status))
      throw new CourseError('version_locked');
    return write(tx);
  });
}

export async function createContentItem(
  db: Db,
  user: AuthUser | null,
  nodeId: string,
  input: unknown,
) {
  const data = parse(createInput, input);
  if (data.kind === 'video' && !data.videoUrl && !data.videoStorageKey) {
    throw invalid('A video needs a link or an uploaded file.', 'videoUrl');
  }
  const transcriptText =
    data.kind === 'video' && !blank(data.transcriptText) ? data.transcriptText!.trim() : null;
  return editNode(db, user, nodeId, async (tx) => {
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${contentItems.ord}), -1)` })
      .from(contentItems)
      .where(eq(contentItems.nodeId, nodeId));
    const [row] = await tx
      .insert(contentItems)
      .values({
        id: randomUUID(),
        nodeId,
        kind: data.kind,
        title: data.title,
        ord: data.ord ?? Number(last!.max) + 1,
        ...(data.kind === 'markdown'
          ? { bodyMd: data.bodyMd }
          : {
              videoUrl: data.videoUrl ?? null,
              videoStorageKey: data.videoStorageKey ?? null,
              transcriptText,
              transcriptSource: transcriptText ? ('author' as const) : null,
            }),
      })
      .returning();
    return present(row!);
  });
}

async function loadItem(db: Db, user: AuthUser | null, itemId: string) {
  const [item] = z.uuid().safeParse(itemId).success
    ? await db.select().from(contentItems).where(eq(contentItems.id, itemId))
    : [];
  if (!item) throw new CourseError('content_not_found');
  // Same rule as for the node: an item the caller may not see looks like a missing one.
  await loadNode(db, user, item.nodeId).catch((err) => {
    throw err instanceof CourseError ? new CourseError('content_not_found') : err;
  });
  return item;
}

/** Edits an item. The kind cannot change. A transcript the author types is theirs; one left alone keeps its source. */
export async function updateContentItem(
  db: Db,
  user: AuthUser | null,
  itemId: string,
  input: unknown,
) {
  const patch = parse(updateInput, input);
  if (Object.keys(patch).length === 0) throw invalid('Nothing to update.');
  const seen = await loadItem(db, user, itemId);

  return editNode(db, user, seen.nodeId, async (tx) => {
    // Read again under a row lock: the patch is worked out from the row as it is now, not as it was.
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, itemId))
      .for('update');
    if (!item) throw new CourseError('content_not_found');

    const next: Partial<typeof contentItems.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.ord !== undefined) next.ord = patch.ord;
    if (item.kind === 'markdown') {
      if (
        patch.videoUrl !== undefined ||
        patch.videoStorageKey !== undefined ||
        patch.transcriptText !== undefined
      ) {
        throw invalid('A markdown item has no video fields.');
      }
      if (patch.bodyMd !== undefined) next.bodyMd = patch.bodyMd;
    } else {
      if (patch.bodyMd !== undefined) throw invalid('A video item has no markdown body.');
      if (patch.videoUrl !== undefined) next.videoUrl = patch.videoUrl;
      if (patch.videoStorageKey !== undefined) next.videoStorageKey = patch.videoStorageKey;
      const url = patch.videoUrl !== undefined ? patch.videoUrl : item.videoUrl;
      const key =
        patch.videoStorageKey !== undefined ? patch.videoStorageKey : item.videoStorageKey;
      if (!url && !key) throw invalid('A video needs a link or an uploaded file.', 'videoUrl');

      const authorEdited =
        patch.transcriptText !== undefined &&
        (patch.transcriptText ?? '').trim() !== (item.transcriptText ?? '').trim();
      if (authorEdited) {
        const text = blank(patch.transcriptText) ? null : patch.transcriptText!.trim();
        next.transcriptText = text;
        next.transcriptSource = text ? 'author' : null;
      } else if (key !== item.videoStorageKey && item.transcriptSource === 'whisper') {
        // A new file makes the old automatic transcript wrong, even if the editor sent it back unchanged.
        next.transcriptText = null;
        next.transcriptSource = null;
      }
    }

    const [row] = await tx
      .update(contentItems)
      .set(next)
      .where(eq(contentItems.id, itemId))
      .returning();
    return present(row!);
  });
}

export async function deleteContentItem(db: Db, user: AuthUser | null, itemId: string) {
  const item = await loadItem(db, user, itemId);
  await editNode(db, user, item.nodeId, async (tx) => {
    await tx.delete(contentItems).where(eq(contentItems.id, itemId));
  });
}

/** The stored video for `key`, if the caller may see a version that uses it. Otherwise it does not exist. */
export async function getVideoFile(db: Db, user: AuthUser | null, storageDir: string, key: string) {
  const viewer = requireRole(user, 'student', 'author', 'expert', 'admin');
  const file = await statVideo(storageDir, key); // also rejects keys that are not ours
  const uses = await db
    .select({ nodeId: nodes.id, version: courseVersions, authorId: courses.authorId })
    .from(contentItems)
    .innerJoin(nodes, eq(nodes.id, contentItems.nodeId))
    .innerJoin(courseVersions, eq(courseVersions.id, nodes.courseVersionId))
    .innerJoin(courses, eq(courses.id, courseVersions.courseId))
    .where(and(eq(contentItems.videoStorageKey, key)));
  for (const u of uses) {
    if (!canView(viewer, u.version, u.authorId)) continue;
    // A video of a locked node stays closed, like the node's text.
    const open = await assertNodeAccess(db, viewer, u.nodeId).then(
      () => true,
      (err) => (err instanceof CourseError ? false : Promise.reject(err)),
    );
    if (open) return file;
  }
  throw new CourseError('media_not_found');
}

/** Whether `user` may upload videos at all. */
export const canUploadVideo = (user: AuthUser | null) => !!user && hasRole(user, 'author', 'admin');
