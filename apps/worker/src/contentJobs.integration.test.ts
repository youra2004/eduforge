import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createContentItem,
  findStaleNodeIds,
  getVersionGraph,
  indexNode,
  importCourse,
  saveVideo,
  type AuthUser,
} from '@eduforge/core';
import { contentChunks, contentItems, createDb, users } from '@eduforge/db';
import {
  DrizzleLLMRunStore,
  EmbeddingClient,
  MockEmbeddingProvider,
  MockTranscriptionProvider,
  TranscriptionClient,
} from '@eduforge/llm';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import {
  enqueueIndexNode,
  enqueueTranscribe,
  reconcileContent,
  registerContentJobs,
} from './contentJobs';

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url);
const boss = new PgBoss(url);
const demo = JSON.parse(
  readFileSync(new URL('../../../packages/core/seed/demo-course.json', import.meta.url), 'utf8'),
);

let storageDir: string;
beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'eduforge-worker-'));
  await boss.start();
});
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

async function course() {
  const [row] = await db
    .insert(users)
    .values({ email: `worker-${Date.now()}@test.local`, passwordHash: 'x', displayName: 'Т' })
    .returning();
  const author: AuthUser = { id: row!.id, email: row!.email, displayName: 'Т', roles: ['author'] };
  const { versionId } = await importCourse(db, { ...demo, slug: `w-${Date.now()}` }, author.id);
  const graph = await getVersionGraph(db, author, versionId);
  return { author, nodeIds: graph.nodes.map((n) => n.id) };
}

describe('content jobs', () => {
  it('index, transcribe and reconcile jobs run on the worker', async () => {
    const { author, nodeIds } = await course();
    const [textNode, videoNode] = nodeIds as [string, string];
    const embedProvider = new MockEmbeddingProvider(1024);
    const embedder = new EmbeddingClient(embedProvider, new DrizzleLLMRunStore(db));
    // The sweep at start-up queues every stale node in the database, including ones other test files left
    // behind; index those now so this test's own jobs are not stuck behind them.
    for (const id of await findStaleNodeIds(db)) await indexNode(db, embedder, id);
    await registerContentJobs(boss, {
      db,
      embedder,
      transcriber: new TranscriptionClient(
        new MockTranscriptionProvider(),
        new DrizzleLLMRunStore(db),
      ),
      storageDir,
    });

    // an index job fills the chunks
    await createContentItem(db, author, textNode, {
      kind: 'markdown',
      title: 'Т',
      bodyMd: 'Текст про змінні.',
    });
    await enqueueIndexNode(boss, textNode);
    await waitFor(
      async () =>
        (await db.select().from(contentChunks).where(eq(contentChunks.nodeId, textNode))).length ===
        1,
    );

    // a stored video gets a Whisper transcript, and the transcript is then indexed
    const { key } = await saveVideo(storageDir, [Buffer.from('\0\0\0\x18ftypmp42 fake video')]);
    const video = await createContentItem(db, author, videoNode, {
      kind: 'video',
      title: 'В',
      videoStorageKey: key,
    });
    await enqueueTranscribe(boss, video.id);
    await waitFor(
      async () =>
        (await db.select().from(contentChunks).where(eq(contentChunks.nodeId, videoNode)))
          .length === 1,
    );
    const [row] = await db.select().from(contentItems).where(eq(contentItems.id, video.id));
    expect(row).toMatchObject({ transcriptSource: 'whisper' });

    // work that was never queued is picked up by the sweep
    const third = nodeIds[2]!;
    await createContentItem(db, author, third, {
      kind: 'markdown',
      title: 'Н',
      bodyMd: 'Нічия черга.',
    });
    expect(await reconcileContent(boss, { db })).toMatchObject({ nodes: expect.any(Number) });
    await waitFor(
      async () =>
        (await db.select().from(contentChunks).where(eq(contentChunks.nodeId, third))).length === 1,
    );
  });
});
