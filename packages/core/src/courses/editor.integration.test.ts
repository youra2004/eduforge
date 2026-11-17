import { readFileSync } from 'node:fs';
import {
  contentItems,
  courseVersions,
  createDb,
  nodeEdges,
  nodes,
  questions,
  users,
} from '@eduforge/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthError, type AuthUser } from '../auth/guard';
import { editGraph } from './editor';
import { CourseError } from './errors';
import { createCourse, getVersionGraph, importCourse } from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);

let n = 0;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `editor-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning();
  return { id: row!.id, email, displayName: 'Тест', roles };
}
const slug = () => `ed-${Date.now()}-${n++}`;

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError || err instanceof AuthError) return err.code;
    return `other:${String(err)}`;
  }
  return 'none';
}

describe('createCourse', () => {
  it('starts an empty draft version 1 for an author', async () => {
    const author = await makeUser(['author']);
    const { versionId } = await createCourse(db, author, {
      slug: slug(),
      title: 'Новий курс',
      description: 'Опис',
      declaredLevel: 'middle',
    });
    const g = await getVersionGraph(db, author, versionId);
    expect(g.version).toMatchObject({ status: 'draft', versionNo: 1, declaredLevel: 'middle' });
    expect(g.nodes).toHaveLength(0);
    expect(g.issues.map((i) => i.code)).toEqual(['no_nodes']);
  });

  it('refuses students, a taken slug and bad input', async () => {
    const author = await makeUser(['author']);
    const s = slug();
    await createCourse(db, author, { slug: s, title: 'А' });
    expect(await codeOf(createCourse(db, author, { slug: s, title: 'Б' }))).toBe('slug_taken');
    expect(await codeOf(createCourse(db, author, { slug: 'Bad Slug', title: 'Б' }))).toBe(
      'invalid_course',
    );
    expect(await codeOf(createCourse(db, author, { slug: slug(), title: '' }))).toBe(
      'invalid_course',
    );
    const student = await makeUser(['student']);
    expect(await codeOf(createCourse(db, student, { slug: slug(), title: 'В' }))).toBe('forbidden');
    expect(await codeOf(createCourse(db, null, { slug: slug(), title: 'В' }))).toBe(
      'unauthenticated',
    );
  });
});

describe('editGraph', () => {
  async function fresh() {
    const author = await makeUser(['author']);
    const { versionId } = await createCourse(db, author, { slug: slug(), title: 'Граф' });
    return { author, versionId };
  }

  it('builds a graph: skills, nodes, prerequisites, positions', async () => {
    const { author, versionId } = await fresh();
    const { skillId } = (await editGraph(db, author, versionId, {
      op: 'add_skill',
      name: 'Змінні',
    })) as { skillId: string };
    const a = (await editGraph(db, author, versionId, {
      op: 'add_node',
      title: 'Перший',
      skillIds: [skillId],
    })) as { nodeId: string };
    const b = (await editGraph(db, author, versionId, { op: 'add_node', title: 'Другий' })) as {
      nodeId: string;
    };
    await editGraph(db, author, versionId, { op: 'add_edge', from: a.nodeId, to: b.nodeId });
    await editGraph(db, author, versionId, {
      op: 'update_node',
      nodeId: b.nodeId,
      title: 'Другий вузол',
      summary: 'Про щось',
      skillIds: [skillId],
      position: { x: 10, y: 20 },
    });
    const g = await getVersionGraph(db, author, versionId);
    expect(g.nodes.map((x) => x.title).sort()).toEqual(['Другий вузол', 'Перший']);
    expect(g.nodes.find((x) => x.id === b.nodeId)).toMatchObject({
      summary: 'Про щось',
      position: { x: 10, y: 20 },
      skillIds: [skillId],
    });
    expect(g.edges).toEqual([{ from: a.nodeId, to: b.nodeId }]);
    expect(g.issues).toEqual([]);

    await editGraph(db, author, versionId, { op: 'delete_edge', from: a.nodeId, to: b.nodeId });
    expect((await getVersionGraph(db, author, versionId)).edges).toEqual([]);
  });

  it('refuses a cycle, a self-loop, a duplicate and nodes of another version', async () => {
    const { author, versionId } = await fresh();
    const mk = async (title: string) =>
      ((await editGraph(db, author, versionId, { op: 'add_node', title })) as { nodeId: string })
        .nodeId;
    const [a, b, c] = [await mk('A'), await mk('B'), await mk('C')];
    await editGraph(db, author, versionId, { op: 'add_edge', from: a!, to: b! });
    await editGraph(db, author, versionId, { op: 'add_edge', from: b!, to: c! });

    const cycle = await editGraph(db, author, versionId, {
      op: 'add_edge',
      from: c!,
      to: a!,
    }).catch((e) => e);
    expect(cycle).toBeInstanceOf(CourseError);
    expect(cycle.code).toBe('invalid_graph_edit');
    expect(cycle.issues[0].code).toBe('cycle');
    expect(
      await codeOf(editGraph(db, author, versionId, { op: 'add_edge', from: a!, to: a! })),
    ).toBe('invalid_graph_edit');
    expect(
      await codeOf(editGraph(db, author, versionId, { op: 'add_edge', from: a!, to: b! })),
    ).toBe('invalid_graph_edit');
    // nothing was written by the refused edits
    expect(
      (await db.select().from(nodeEdges)).filter((e) => [a, b, c].includes(e.nodeId)),
    ).toHaveLength(2);

    const other = await fresh();
    const foreign = (
      (await editGraph(db, other.author, other.versionId, {
        op: 'add_node',
        title: 'Чужий',
      })) as { nodeId: string }
    ).nodeId;
    expect(
      await codeOf(editGraph(db, author, versionId, { op: 'add_edge', from: a!, to: foreign })),
    ).toBe('invalid_graph_edit');
    expect(
      await codeOf(
        editGraph(db, author, versionId, { op: 'update_node', nodeId: foreign, title: 'X' }),
      ),
    ).toBe('invalid_graph_edit');
    expect(await codeOf(editGraph(db, author, versionId, { op: 'nope' }))).toBe(
      'invalid_graph_edit',
    );
  });

  it('deleting a node takes its edges, content and questions along', async () => {
    const author = await makeUser(['author']);
    const { versionId } = await importCourse(
      db,
      { ...structuredClone(demo), slug: slug() },
      author.id,
    );
    const g = await getVersionGraph(db, author, versionId);
    const victim = g.nodes.find(
      (x) => g.edges.some((e) => e.to === x.id) && g.edges.some((e) => e.from === x.id),
    )!;
    await db
      .insert(contentItems)
      .values({ nodeId: victim.id, kind: 'markdown', title: 'т', bodyMd: 'т' });
    await db.insert(questions).values({
      nodeId: victim.id,
      skillId: victim.skillIds[0]!,
      pool: 'node',
      kind: 'mcq',
      promptMd: 'П?',
      options: ['а', 'б'],
      answerKey: { optionIndex: 0 },
      guess: 0.5,
    });
    await editGraph(db, author, versionId, { op: 'delete_node', nodeId: victim.id });
    const after = await getVersionGraph(db, author, versionId);
    expect(after.nodes.some((x) => x.id === victim.id)).toBe(false);
    expect(after.edges.some((e) => e.from === victim.id || e.to === victim.id)).toBe(false);
    expect(
      await db.select().from(contentItems).where(eq(contentItems.nodeId, victim.id)),
    ).toHaveLength(0);
    expect(await db.select().from(questions).where(eq(questions.nodeId, victim.id))).toHaveLength(
      0,
    );
  });

  it('a skill with questions cannot be deleted; renaming drops its verdict', async () => {
    const author = await makeUser(['author']);
    const { versionId } = await importCourse(
      db,
      { ...structuredClone(demo), slug: slug() },
      author.id,
    );
    const g = await getVersionGraph(db, author, versionId);
    const node = g.nodes[0]!;
    const skillId = node.skillIds[0]!;
    await db.insert(questions).values({
      nodeId: node.id,
      skillId,
      pool: 'node',
      kind: 'mcq',
      promptMd: 'П?',
      options: ['а', 'б'],
      answerKey: { optionIndex: 0 },
      guess: 0.5,
    });
    expect(await codeOf(editGraph(db, author, versionId, { op: 'delete_skill', skillId }))).toBe(
      'invalid_graph_edit',
    );
    const fresh = (await editGraph(db, author, versionId, {
      op: 'add_skill',
      name: 'Тимчасова',
    })) as {
      skillId: string;
    };
    await editGraph(db, author, versionId, {
      op: 'update_skill',
      skillId: fresh.skillId,
      name: 'Інша',
    });
    await editGraph(db, author, versionId, { op: 'delete_skill', skillId: fresh.skillId });
    expect(
      (await getVersionGraph(db, author, versionId)).skills.some((s) => s.id === fresh.skillId),
    ).toBe(false);
  });

  it('only the owner or an admin edits, and only while the version is editable', async () => {
    const { author, versionId } = await fresh();
    const stranger = await makeUser(['author']);
    expect(await codeOf(editGraph(db, stranger, versionId, { op: 'add_skill', name: 'X' }))).toBe(
      'course_not_found',
    );
    const admin = await makeUser(['admin']);
    expect(await codeOf(editGraph(db, admin, versionId, { op: 'add_skill', name: 'X' }))).toBe(
      'none',
    );
    const expert = await makeUser(['expert']);
    // an expert may see a draft but not change it
    expect(await codeOf(editGraph(db, expert, versionId, { op: 'add_skill', name: 'X' }))).toBe(
      'forbidden',
    );
    for (const status of ['auditing', 'ready_to_publish', 'expert_review', 'published'] as const) {
      await db.update(courseVersions).set({ status }).where(eq(courseVersions.id, versionId));
      expect(await codeOf(editGraph(db, author, versionId, { op: 'add_skill', name: 'Y' }))).toBe(
        'version_locked',
      );
    }
    await db
      .update(courseVersions)
      .set({ status: 'changes_requested' })
      .where(eq(courseVersions.id, versionId));
    expect(await codeOf(editGraph(db, author, versionId, { op: 'add_skill', name: 'Z' }))).toBe(
      'none',
    );
    expect((await db.select().from(nodes).where(eq(nodes.courseVersionId, versionId))).length).toBe(
      0,
    );
  });
});
