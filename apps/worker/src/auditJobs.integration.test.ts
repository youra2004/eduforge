import { readFileSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditMockResponders,
  AUDIT_QUEUE,
  createContentItem,
  getVersionGraph,
  importCourse,
  submitForAudit,
  type AuditSettings,
  type AuthUser,
} from '@eduforge/core';
import { courseVersions, createDb, llmRuns, questions, users } from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient, MockLLMProvider } from '@eduforge/llm';
import { eq } from 'drizzle-orm';
import { registerAuditJobs } from './auditJobs';

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url);
const boss = new PgBoss(url);
const { good } = JSON.parse(
  readFileSync(new URL('../../../packages/core/seed/audit-fixtures.json', import.meta.url), 'utf8'),
) as {
  good: { course: { nodes: { key: string; title: string }[] }; content: Record<string, string> };
};
const settings: AuditSettings = {
  maxAttempts: 5,
  scoringRuns: 3,
  rating: { bands: { junior: [1, 3], middle: [4, 6], senior: [7, 9] }, volumeCaps: [] },
  pools: { nodeMinPerSkill: 4, examMinPerSkill: 3 },
};

let author: AuthUser;
let failing = false;
const llm = new LLMClient(
  new MockLLMProvider({
    ...auditMockResponders,
    audit_scoring: (req) => {
      if (failing) throw new Error('provider down');
      return auditMockResponders.audit_scoring(req);
    },
  }),
  new DrizzleLLMRunStore(db),
);

beforeAll(async () => {
  await boss.start();
  const [row] = await db
    .insert(users)
    .values({
      email: `audit-job-${Date.now()}@test.local`,
      passwordHash: 'x',
      displayName: 'Автор',
    })
    .returning();
  author = { id: row!.id, email: row!.email, displayName: 'Автор', roles: ['author'] };
  await registerAuditJobs(boss, { db, llm, settings, retryDelay: 1 });
});
afterAll(async () => {
  await boss.stop();
  await pool.end();
});

/** The fixture course (text in every node) with full pools. */
async function ready() {
  const { versionId } = await importCourse(
    db,
    {
      ...structuredClone(good.course),
      slug: `audit-job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    author.id,
  );
  const graph = await getVersionGraph(db, author, versionId);
  for (const node of graph.nodes) {
    const key = good.course.nodes.find((n) => n.title === node.title)!.key;
    await createContentItem(db, author, node.id, {
      kind: 'markdown',
      title: node.title,
      bodyMd: good.content[key]!,
    });
    for (const skillId of node.skillIds) {
      await db.insert(questions).values(
        (['node', 'node', 'node', 'node', 'exam', 'exam', 'exam'] as const).map((pool) => ({
          nodeId: node.id,
          skillId,
          pool,
          kind: 'mcq' as const,
          promptMd: 'П?',
          options: ['а', 'б'],
          answerKey: { optionIndex: 0 },
          guess: 0.5,
          status: 'validated' as const,
        })),
      );
    }
  }
  return versionId;
}

async function waitFor(versionId: string, done: (status: string) => boolean) {
  for (let i = 0; i < 60; i++) {
    const [v] = await db.select().from(courseVersions).where(eq(courseVersions.id, versionId));
    if (done(v!.status)) return v!;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out waiting for the audit');
}

describe('audit jobs', () => {
  it('the worker runs a queued audit and the version leaves auditing', async () => {
    failing = false;
    const versionId = await ready();
    const job = await submitForAudit(db, author, versionId, settings);
    await boss.send(AUDIT_QUEUE, job, { singletonKey: `${job.versionId}:${job.attemptNo}` });
    const v = await waitFor(versionId, (s) => s !== 'auditing');
    expect(v).toMatchObject({ status: 'ready_to_publish', rating: 5 });
    const runs = await db.select().from(llmRuns).where(eq(llmRuns.subjectId, versionId));
    // conformity + skills + 3 scoring runs
    expect(runs).toHaveLength(5);
  });

  it('gives the run back when the provider keeps failing', async () => {
    failing = true;
    const versionId = await ready();
    const job = await submitForAudit(db, author, versionId, settings);
    await boss.send(AUDIT_QUEUE, job, { singletonKey: `${job.versionId}:${job.attemptNo}` });
    const v = await waitFor(versionId, (s) => s !== 'auditing');
    failing = false;
    expect(v).toMatchObject({ status: 'changes_requested', auditAttempts: 0 });
    expect(v.auditSummary).toMatchObject({ failedStage: 'technical' });
  }, 60_000);
});
