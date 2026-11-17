import { readFileSync } from 'node:fs';
import {
  courses,
  courseVersions,
  createDb,
  nodeEdges,
  nodes,
  nodeSkills,
  skills,
  users,
  staticHints,
} from '@eduforge/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthError, type AuthUser } from '../auth/guard';
import { CourseError } from './errors';
import {
  createNewVersion,
  getVersionGraph,
  importCourse,
  listCourseVersions,
  updateVersion,
} from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);

let n = 0;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `course-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning();
  return { id: row!.id, email, displayName: 'Тест', roles };
}

const slug = () => `c-${Date.now()}-${n++}`;
const course = (extra: object = {}) => ({ ...structuredClone(demo), slug: slug(), ...extra });

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError || err instanceof AuthError) return err.code;
    return `other:${String(err)}`;
  }
  return 'none';
}

async function counts() {
  const c = async (
    t: typeof courses | typeof courseVersions | typeof skills | typeof nodes | typeof nodeEdges,
  ) => (await db.select().from(t)).length;
  return [
    await c(courses),
    await c(courseVersions),
    await c(skills),
    await c(nodes),
    await c(nodeEdges),
  ];
}

async function publish(versionId: string) {
  await db
    .update(courseVersions)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(courseVersions.id, versionId));
}

describe('importCourse', () => {
  it('saves the seed course as a draft version 1 with its graph', async () => {
    const author = await makeUser(['author']);
    const { versionId } = await importCourse(db, course(), author.id);

    const g = await getVersionGraph(db, author, versionId);
    expect(g.version).toMatchObject({ versionNo: 1, status: 'draft', parentVersionId: null });
    expect(g.nodes).toHaveLength(8);
    expect(g.skills).toHaveLength(11);
    expect(g.edges).toHaveLength(9);
    expect(g.issues).toEqual([]);
    for (const node of g.nodes) expect(node.skillIds.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects an invalid course with the full list of errors and saves nothing', async () => {
    const author = await makeUser(['author']);
    const bad = course();
    bad.edges.push({ from: 'files', to: 'start' }); // closes a cycle through the whole graph
    bad.nodes.push({ key: 'lonely', title: 'Самотній', summary: '', skills: [] });
    const before = await counts();

    const err = await importCourse(db, bad, author.id).catch((e) => e);
    expect(err).toBeInstanceOf(CourseError);
    expect(err.code).toBe('invalid_course');
    expect(err.status).toBe(422);
    expect(err.issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(['cycle', 'isolated', 'node_without_skill']),
    );
    expect(await counts()).toEqual(before);
  });

  it('rejects a duplicate slug and saves nothing', async () => {
    const author = await makeUser(['author']);
    const taken = slug();
    await importCourse(db, course({ slug: taken }), author.id);
    const before = await counts();
    expect(await codeOf(importCourse(db, course({ slug: taken }), author.id))).toBe('slug_taken');
    expect(await counts()).toEqual(before);
  });

  it('is transactional: when a late insert fails, the earlier rows are rolled back', async () => {
    const author = await makeUser(['author']);
    const before = await counts();
    // Passes validation, but Postgres refuses NUL in text, and nodes are inserted after the course,
    // version and skills rows.
    const bad = course();
    bad.nodes[3].title = 'Цикли\u0000';
    const err = await importCourse(db, bad, author.id).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CourseError);
    expect(await counts()).toEqual(before);
  });
});

describe('visibility', () => {
  it('shows drafts only to the owner, admins and experts; published to everyone', async () => {
    const owner = await makeUser(['author']);
    const other = await makeUser(['student']);
    const admin = await makeUser(['admin']);
    const roleless = await makeUser([]);
    const { versionId } = await importCourse(db, course(), owner.id);

    expect(await codeOf(getVersionGraph(db, other, versionId))).toBe('course_not_found');
    expect(await codeOf(getVersionGraph(db, roleless, versionId))).toBe('forbidden');
    expect(await codeOf(listCourseVersions(db, roleless))).toBe('forbidden');
    expect(await codeOf(getVersionGraph(db, admin, versionId))).toBe('none');
    expect(await codeOf(getVersionGraph(db, null, versionId))).toBe('unauthenticated');
    expect(await codeOf(getVersionGraph(db, owner, 'not-a-uuid'))).toBe('course_not_found');
    expect((await listCourseVersions(db, other)).some((v) => v.versionId === versionId)).toBe(
      false,
    );
    expect((await listCourseVersions(db, owner)).some((v) => v.versionId === versionId)).toBe(true);

    await publish(versionId);
    expect(await codeOf(getVersionGraph(db, other, versionId))).toBe('none');
    expect((await listCourseVersions(db, other)).some((v) => v.versionId === versionId)).toBe(true);
  });
});

describe('immutability of published versions (D-06)', () => {
  it('lets the owner edit a draft but rejects the same edit once published', async () => {
    const owner = await makeUser(['author']);
    const { versionId } = await importCourse(db, course(), owner.id);

    const edited = await updateVersion(db, owner, versionId, { title: 'Нова назва' });
    expect(edited.title).toBe('Нова назва');

    await publish(versionId);
    expect(await codeOf(updateVersion(db, owner, versionId, { title: 'Інша назва' }))).toBe(
      'version_locked',
    );
    const [row] = await db.select().from(courseVersions).where(eq(courseVersions.id, versionId));
    expect(row!.title).toBe('Нова назва');
  });

  it.each(['auditing', 'ready_to_publish', 'expert_review', 'archived'] as const)(
    'also rejects edits while the version is %s',
    async (status) => {
      const owner = await makeUser(['author']);
      const { versionId } = await importCourse(db, course(), owner.id);
      await db.update(courseVersions).set({ status }).where(eq(courseVersions.id, versionId));
      expect(await codeOf(updateVersion(db, owner, versionId, { title: 'x' }))).toBe(
        'version_locked',
      );
    },
  );

  it('rejects edits from someone who is neither the owner nor an admin', async () => {
    const owner = await makeUser(['author']);
    const expert = await makeUser(['expert']);
    const { versionId } = await importCourse(db, course(), owner.id);
    expect(await codeOf(updateVersion(db, expert, versionId, { title: 'x' }))).toBe('forbidden');
  });

  it('rejects unknown fields (status cannot be set through an edit)', async () => {
    const owner = await makeUser(['author']);
    const { versionId } = await importCourse(db, course(), owner.id);
    expect(await codeOf(updateVersion(db, owner, versionId, { status: 'published' }))).toBe(
      'invalid_course',
    );
    expect(await codeOf(updateVersion(db, owner, versionId, {}))).toBe('invalid_course');
  });
});

describe('static hints (F1-R4, F6-R6)', () => {
  it('are imported with the node and copied into a new version', async () => {
    const owner = await makeUser(['author']);
    const input = course();
    for (const x of input.nodes) x.hints = [];
    input.nodes[0]!.hints = [{ level: 2, text: 'Перегляньте розділ про змінні.' }];
    const { versionId } = await importCourse(db, input, owner.id);
    await publish(versionId);
    const { versionId: copyId } = await createNewVersion(db, owner, versionId);

    for (const id of [versionId, copyId]) {
      const graph = await getVersionGraph(db, owner, id);
      const nodeIds = graph.nodes.map((x) => x.id);
      const hints = await db.select().from(staticHints).where(inArray(staticHints.nodeId, nodeIds));
      expect(hints.map((h) => [h.level, h.text])).toEqual([[2, 'Перегляньте розділ про змінні.']]);
    }
    const bad = structuredClone(input);
    bad.nodes[0]!.hints = [{ level: 4, text: 'x' }];
    expect(await codeOf(importCourse(db, bad, owner.id))).toBe('invalid_course');
  });
});

describe('createNewVersion', () => {
  it('copies skills, nodes, edges and links into a new draft linked to its parent', async () => {
    const owner = await makeUser(['author']);
    const { versionId, courseId } = await importCourse(db, course(), owner.id);
    await publish(versionId);

    const created = await createNewVersion(db, owner, versionId);
    expect(created).toMatchObject({ courseId, versionNo: 2 });

    const [v2] = await db
      .select()
      .from(courseVersions)
      .where(eq(courseVersions.id, created.versionId));
    expect(v2).toMatchObject({ status: 'draft', parentVersionId: versionId, publishedAt: null });

    const [g1, g2] = [
      await getVersionGraph(db, owner, versionId),
      await getVersionGraph(db, owner, created.versionId),
    ];
    // same structure, expressed by titles/names because the ids are new
    const shape = (g: typeof g1) => {
      const nodeTitle = new Map(g.nodes.map((x) => [x.id, x.title]));
      const skillName = new Map(g.skills.map((s) => [s.id, s.name]));
      return {
        skills: g.skills.map((s) => s.name).sort(),
        nodes: g.nodes
          .map(
            (x) =>
              `${x.title}: ${x.skillIds
                .map((s) => skillName.get(s))
                .sort()
                .join(', ')}`,
          )
          .sort(),
        edges: g.edges.map((e) => `${nodeTitle.get(e.from)} > ${nodeTitle.get(e.to)}`).sort(),
      };
    };
    expect(shape(g2)).toEqual(shape(g1));
    expect(g2.nodes.length).toBe(8);

    // nothing is shared: the copies have their own ids, so editing one version can never touch the other
    const oldIds = new Set([...g1.nodes.map((x) => x.id), ...g1.skills.map((s) => s.id)]);
    for (const id of [...g2.nodes.map((x) => x.id), ...g2.skills.map((s) => s.id)]) {
      expect(oldIds.has(id)).toBe(false);
    }
    const links = await db
      .select()
      .from(nodeSkills)
      .where(
        inArray(
          nodeSkills.nodeId,
          g2.nodes.map((x) => x.id),
        ),
      );
    expect(links).toHaveLength(g2.nodes.reduce((sum, x) => sum + x.skillIds.length, 0));

    // the new draft is editable, the published parent still is not
    expect((await updateVersion(db, owner, created.versionId, { title: 'v2' })).title).toBe('v2');
    expect(await codeOf(updateVersion(db, owner, versionId, { title: 'x' }))).toBe(
      'version_locked',
    );
  });

  it('numbers versions one after another, even when asked twice at once', async () => {
    const owner = await makeUser(['author']);
    const { versionId, courseId } = await importCourse(db, course(), owner.id);
    await publish(versionId);

    await Promise.all([
      createNewVersion(db, owner, versionId),
      createNewVersion(db, owner, versionId),
    ]);
    const rows = await db
      .select()
      .from(courseVersions)
      .where(eq(courseVersions.courseId, courseId));
    expect(rows.map((r) => r.versionNo).sort()).toEqual([1, 2, 3]);
  });

  it('only starts from a published version, and only for the owner or an admin', async () => {
    const owner = await makeUser(['author']);
    const stranger = await makeUser(['student']);
    const admin = await makeUser(['admin']);
    const { versionId } = await importCourse(db, course(), owner.id);

    expect(await codeOf(createNewVersion(db, owner, versionId))).toBe('version_not_published');
    await publish(versionId);
    expect(await codeOf(createNewVersion(db, stranger, versionId))).toBe('forbidden');
    expect(await codeOf(createNewVersion(db, admin, versionId))).toBe('none');
  });
});
