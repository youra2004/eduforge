import { randomUUID } from 'node:crypto';
import {
  courses,
  courseVersions,
  nodeEdges,
  nodes,
  nodeSkills,
  skills,
  users,
  type CourseVersion,
  type Db,
  roles as allRoles,
  type VersionStatus,
} from '@eduforge/db';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthError, hasRole, requireRole, type AuthUser } from '../auth/guard';
import { CourseError } from './errors';
import { validateGraph, type CourseIssue } from './graph';
import { contentIssues } from '../content/validation';
import { copyContent } from '../content/copy';
import { declaredLevels, parseCourseImport } from './import';

/** Anyone holding a role may browse; a signed-in user with every role removed may not. */
const viewer = (user: AuthUser | null) => requireRole(user, ...allRoles);

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Only these statuses may be edited. Everything from the audit onwards is frozen; a published version for good (D-06). */
export const EDITABLE_STATUSES: VersionStatus[] = ['draft', 'changes_requested'];

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function insertAll<T>(rows: T[], insert: (rows: T[]) => Promise<unknown>) {
  return rows.length > 0 ? insert(rows) : Promise.resolve();
}

/**
 * Imports a course as version 1 (a draft) owned by `authorId`, in one transaction.
 * Invalid input throws `invalid_course` with the full list of problems and writes nothing.
 * Callers check the caller's role; the CLI has no session.
 */
export async function importCourse(db: Db, input: unknown, authorId: string) {
  const parsed = parseCourseImport(input);
  if (!parsed.ok) throw new CourseError('invalid_course', parsed.issues);
  const data = parsed.data;

  const skillIds = new Map(data.skills.map((s) => [s.key, randomUUID()]));
  const nodeIds = new Map(data.nodes.map((n) => [n.key, randomUUID()]));
  const courseId = randomUUID();
  const versionId = randomUUID();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(courses).values({ id: courseId, authorId, slug: data.slug });
      await tx.insert(courseVersions).values({
        id: versionId,
        courseId,
        versionNo: 1,
        title: data.title,
        description: data.description,
        declaredLevel: data.declaredLevel,
      });
      await insertAll(data.skills, (rows) =>
        tx.insert(skills).values(
          rows.map((s) => ({
            id: skillIds.get(s.key)!,
            courseVersionId: versionId,
            name: s.name,
            description: s.description,
          })),
        ),
      );
      await insertAll(data.nodes, (rows) =>
        tx.insert(nodes).values(
          rows.map((n) => ({
            id: nodeIds.get(n.key)!,
            courseVersionId: versionId,
            title: n.title,
            summary: n.summary,
            position: n.position,
          })),
        ),
      );
      await insertAll(
        data.nodes.flatMap((n) =>
          [...new Set(n.skills)].map((s) => ({
            nodeId: nodeIds.get(n.key)!,
            skillId: skillIds.get(s)!,
          })),
        ),
        (rows) => tx.insert(nodeSkills).values(rows),
      );
      await insertAll(data.edges, (rows) =>
        tx
          .insert(nodeEdges)
          .values(
            rows.map((e) => ({ prereqNodeId: nodeIds.get(e.from)!, nodeId: nodeIds.get(e.to)! })),
          ),
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CourseError('slug_taken');
    throw err;
  }
  return { courseId, versionId };
}

/** A version is visible if it is published, or the user owns the course, or is an admin or expert. */
export function canView(user: AuthUser, version: CourseVersion, authorId: string) {
  return version.status === 'published' || authorId === user.id || hasRole(user, 'admin', 'expert');
}

export const canEdit = (user: AuthUser, authorId: string) =>
  authorId === user.id || hasRole(user, 'admin');

export async function loadVersion(db: Db | Tx, user: AuthUser | null, versionId: string) {
  const viewing = viewer(user);
  const [row] = z.uuid().safeParse(versionId).success
    ? await db
        .select({ version: courseVersions, course: courses })
        .from(courseVersions)
        .innerJoin(courses, eq(courses.id, courseVersions.courseId))
        .where(eq(courseVersions.id, versionId))
    : [];
  // Versions the user may not see look the same as missing ones.
  if (!row || !canView(viewing, row.version, row.course.authorId)) {
    throw new CourseError('course_not_found');
  }
  return { user: viewing, ...row };
}

/** The versions the user may see, newest course first. */
export async function listCourseVersions(db: Db, caller: AuthUser | null) {
  const user = viewer(caller);
  const all = hasRole(user, 'admin', 'expert');
  return db
    .select({
      versionId: courseVersions.id,
      courseId: courses.id,
      slug: courses.slug,
      versionNo: courseVersions.versionNo,
      title: courseVersions.title,
      declaredLevel: courseVersions.declaredLevel,
      status: courseVersions.status,
      authorName: users.displayName,
    })
    .from(courseVersions)
    .innerJoin(courses, eq(courses.id, courseVersions.courseId))
    .innerJoin(users, eq(users.id, courses.authorId))
    .where(
      all ? undefined : or(eq(courseVersions.status, 'published'), eq(courses.authorId, user.id)),
    )
    .orderBy(asc(courses.slug), desc(courseVersions.versionNo));
}

/** One version with its skills, nodes (with skill ids), edges and the current validation issues. */
export async function getVersionGraph(db: Db, user: AuthUser | null, versionId: string) {
  const { version, course } = await loadVersion(db, user, versionId);
  const [skillRows, nodeRows] = await Promise.all([
    db.select().from(skills).where(eq(skills.courseVersionId, versionId)).orderBy(asc(skills.name)),
    db.select().from(nodes).where(eq(nodes.courseVersionId, versionId)).orderBy(asc(nodes.title)),
  ]);
  const nodeIds = nodeRows.map((n) => n.id);
  const [links, edgeRows] =
    nodeIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.select().from(nodeSkills).where(inArray(nodeSkills.nodeId, nodeIds)),
          db.select().from(nodeEdges).where(inArray(nodeEdges.nodeId, nodeIds)),
        ]);

  const graphNodes = nodeRows.map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    position: n.position,
    skillIds: links.filter((l) => l.nodeId === n.id).map((l) => l.skillId),
  }));
  const edges = edgeRows.map((e) => ({ from: e.prereqNodeId, to: e.nodeId }));
  const issues: CourseIssue[] = [
    ...validateGraph({ nodes: graphNodes, edges }),
    ...(await contentIssues(db, versionId)),
  ];
  return {
    course: { id: course.id, slug: course.slug, authorId: course.authorId },
    version,
    skills: skillRows.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    nodes: graphNodes,
    edges,
    issues,
  };
}

const updateInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    declaredLevel: z.enum(declaredLevels).nullable(),
  })
  .partial()
  .strict();

/**
 * Edits the version's own fields. Rejected with `version_locked` unless the version is still editable;
 * the check is part of the UPDATE, so a concurrent status change cannot slip past it.
 */
export async function updateVersion(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  input: unknown,
) {
  const { course, user: actor } = await loadVersion(db, user, versionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  const parsed = updateInput.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new CourseError('invalid_course', [
      { code: 'schema', message: 'Expected title, description and/or declaredLevel.' },
    ]);
  }
  const [row] = await db
    .update(courseVersions)
    .set(parsed.data)
    .where(and(eq(courseVersions.id, versionId), inArray(courseVersions.status, EDITABLE_STATUSES)))
    .returning();
  if (!row) throw new CourseError('version_locked');
  return row;
}

/**
 * Starts the next version of a published one: copies skills, nodes, edges and node-skill links into a
 * new draft (not published, audit results not carried over) and links it with `parent_version_id` (D-06).
 * Content items and their chunks are copied too; questions will be once M04 adds them.
 */
export async function createNewVersion(db: Db, user: AuthUser | null, sourceVersionId: string) {
  const { version: source, course, user: actor } = await loadVersion(db, user, sourceVersionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  if (source.status !== 'published') throw new CourseError('version_not_published');

  return db.transaction(async (tx) => {
    // Serialises concurrent "new version" calls for one course so version_no stays gap-free.
    await tx.execute(sql`SELECT id FROM courses WHERE id = ${course.id} FOR UPDATE`);
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${courseVersions.versionNo}), 0)` })
      .from(courseVersions)
      .where(eq(courseVersions.courseId, course.id));
    const next = Number(last!.max) + 1;

    const versionId = randomUUID();
    await tx.insert(courseVersions).values({
      id: versionId,
      courseId: course.id,
      versionNo: next,
      parentVersionId: source.id,
      title: source.title,
      description: source.description,
      declaredLevel: source.declaredLevel,
    });

    const skillRows = await tx.select().from(skills).where(eq(skills.courseVersionId, source.id));
    const nodeRows = await tx.select().from(nodes).where(eq(nodes.courseVersionId, source.id));
    const skillIds = new Map(skillRows.map((s) => [s.id, randomUUID()]));
    const nodeIds = new Map(nodeRows.map((n) => [n.id, randomUUID()]));
    const oldNodeIds = nodeRows.map((n) => n.id);
    const links = oldNodeIds.length
      ? await tx.select().from(nodeSkills).where(inArray(nodeSkills.nodeId, oldNodeIds))
      : [];
    const edgeRows = oldNodeIds.length
      ? await tx.select().from(nodeEdges).where(inArray(nodeEdges.nodeId, oldNodeIds))
      : [];

    await insertAll(skillRows, (rows) =>
      tx.insert(skills).values(
        rows.map((s) => ({
          id: skillIds.get(s.id)!,
          courseVersionId: versionId,
          name: s.name,
          description: s.description,
        })),
      ),
    );
    await insertAll(nodeRows, (rows) =>
      tx.insert(nodes).values(
        rows.map((n) => ({
          id: nodeIds.get(n.id)!,
          courseVersionId: versionId,
          title: n.title,
          summary: n.summary,
          position: n.position,
        })),
      ),
    );
    await insertAll(links, (rows) =>
      tx
        .insert(nodeSkills)
        .values(
          rows.map((l) => ({ nodeId: nodeIds.get(l.nodeId)!, skillId: skillIds.get(l.skillId)! })),
        ),
    );
    await insertAll(edgeRows, (rows) =>
      tx.insert(nodeEdges).values(
        rows.map((e) => ({
          prereqNodeId: nodeIds.get(e.prereqNodeId)!,
          nodeId: nodeIds.get(e.nodeId)!,
        })),
      ),
    );
    await copyContent(tx, nodeIds);
    return { courseId: course.id, versionId, versionNo: next };
  });
}
