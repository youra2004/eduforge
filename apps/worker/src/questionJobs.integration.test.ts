import { readFileSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createContentItem,
  createQuestion,
  createQuestionMock,
  GENERATE_QUESTIONS_QUEUE,
  getVersionGraph,
  importCourse,
  type AuthUser,
  type GenerateQuestionsJob,
} from '@eduforge/core';
import { createDb, questions, users } from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient } from '@eduforge/llm';
import { eq } from 'drizzle-orm';
import { registerQuestionJobs } from './questionJobs';

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url);
const boss = new PgBoss(url);
const demo = JSON.parse(
  readFileSync(new URL('../../../packages/core/seed/demo-course.json', import.meta.url), 'utf8'),
);

beforeAll(() => boss.start());
afterAll(async () => {
  await boss.stop();
  await pool.end();
});

async function waitFor(cond: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting for job');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('question jobs', () => {
  it('generate fans out into validate jobs; pending questions are re-queued on start', async () => {
    const [row] = await db
      .insert(users)
      .values({ email: `qworker-${Date.now()}@test.local`, passwordHash: 'x', displayName: 'Т' })
      .returning();
    const author: AuthUser = {
      id: row!.id,
      email: row!.email,
      displayName: 'Т',
      roles: ['author'],
    };
    const { versionId } = await importCourse(db, { ...demo, slug: `qw-${Date.now()}` }, author.id);
    const graph = await getVersionGraph(db, author, versionId);
    const node = graph.nodes[0]!;
    await createContentItem(db, author, node.id, {
      kind: 'markdown',
      title: 'Теорія',
      bodyMd:
        'Змінна зберігає значення під іменем. Функція print виводить текст на екран. Тип int зберігає цілі числа.',
    });
    // a manual question the web app failed to queue (the worker was down)
    const stuck = await createQuestion(
      db,
      author,
      node.id,
      {
        pool: 'node',
        kind: 'short',
        skillId: node.skillIds[0],
        promptMd: 'Яка функція виводить текст?',
        accepted: ['print'],
      },
      { slip: 0.1 },
    );

    const llm = new LLMClient(createQuestionMock(), new DrizzleLLMRunStore(db));
    await registerQuestionJobs(boss, { db, llm, slip: 0.1 });

    await boss.send(GENERATE_QUESTIONS_QUEUE, {
      nodeId: node.id,
      pool: 'node',
      perSkill: 4,
    } satisfies GenerateQuestionsJob);

    const expected = node.skillIds.length * 4 + 1;
    await waitFor(async () => {
      const rows = await db.select().from(questions).where(eq(questions.nodeId, node.id));
      return rows.length === expected && rows.every((q) => q.status !== 'generated');
    });
    const rows = await db.select().from(questions).where(eq(questions.nodeId, node.id));
    expect(rows.filter((q) => q.status === 'validated').length).toBeGreaterThan(0);
    expect(rows.every((q) => q.validatorRunId !== null)).toBe(true);
    expect(rows.filter((q) => q.generatorRunId !== null)).toHaveLength(node.skillIds.length * 4);
    expect(rows.find((q) => q.id === stuck.id)!.status).toBe('validated');
  });
});
