import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  contentChunks,
  contentItems,
  courseVersions,
  createDb,
  llmRuns,
  users,
} from '@eduforge/db';
import {
  DrizzleLLMRunStore,
  EmbeddingClient,
  MockEmbeddingProvider,
  MockTranscriptionProvider,
  TranscriptionClient,
} from '@eduforge/llm';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthError, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { createNewVersion, getVersionGraph, importCourse } from '../courses/service';
import { findStaleNodeIds, indexNode } from './indexing';
import { retrieve } from './retrieve';
import {
  createContentItem,
  deleteContentItem,
  getVideoFile,
  listNodeContent,
  updateContentItem,
} from './service';
import { saveVideo } from './storage';
import { findUntranscribedItemIds, transcribeItem } from './transcribe';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);

let n = 0;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `content-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning();
  return { id: row!.id, email, displayName: 'Тест', roles };
}

async function setup() {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(demo), slug: `c-${Date.now()}-${n++}` },
    author.id,
  );
  const graph = await getVersionGraph(db, author, versionId);
  return { author, versionId, nodeIds: graph.nodes.map((x) => x.id) };
}

function embedder() {
  const provider = new MockEmbeddingProvider(1024);
  return { provider, client: new EmbeddingClient(provider, new DrizzleLLMRunStore(db)) };
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError || err instanceof AuthError) return err.code;
    return `other:${String(err)}`;
  }
  return 'none';
}

const md = (title: string, bodyMd: string) => ({ kind: 'markdown', title, bodyMd });
const chunkRows = (nodeId: string) =>
  db.select().from(contentChunks).where(eq(contentChunks.nodeId, nodeId));

describe('retrieve', () => {
  it('never returns chunks from nodes outside allowedNodeIds', async () => {
    const { author, nodeIds } = await setup();
    const [a, b, c] = nodeIds as [string, string, string];
    await createContentItem(
      db,
      author,
      a,
      md(
        'Списки',
        'Список у Python зберігає впорядковані елементи. Індексація списку починається з нуля.',
      ),
    );
    await createContentItem(
      db,
      author,
      b,
      md('Бази даних', 'SQL запит SELECT повертає рядки таблиці. JOIN обʼєднує таблиці за ключем.'),
    );
    await createContentItem(
      db,
      author,
      c,
      md('Цикли', 'Цикл for перебирає елементи. Цикл while працює поки умова істинна.'),
    );
    const { client } = embedder();
    for (const id of [a, b, c]) await indexNode(db, client, id);

    // the query is about node b, but b is not allowed
    const onlyA = await retrieve(db, client, {
      allowedNodeIds: [a],
      query: 'SQL JOIN таблиці',
      k: 10,
    });
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyA.every((r) => r.nodeId === a)).toBe(true);

    const aAndC = await retrieve(db, client, {
      allowedNodeIds: [a, c],
      query: 'SQL JOIN таблиці',
      k: 10,
    });
    expect(new Set(aAndC.map((r) => r.nodeId))).toEqual(new Set([a, c]));

    const all = await retrieve(db, client, {
      allowedNodeIds: [a, b, c],
      query: 'SQL JOIN таблиці',
      k: 1,
    });
    expect(all).toHaveLength(1);
    expect(all[0]!.nodeId).toBe(b);
    expect(all[0]!.text).toContain('JOIN');

    expect(await retrieve(db, client, { allowedNodeIds: [], query: 'SQL', k: 5 })).toEqual([]);
  });

  it('still returns k results when most chunks of other nodes are closer to the query', async () => {
    const { author, nodeIds } = await setup();
    const [a, b] = nodeIds as [string, string];
    await createContentItem(db, author, a, md('Мої', 'перше друге третє четверте'));
    const { client, provider } = embedder();
    await indexNode(db, client, a);

    // 400 chunks of another node that are all closer to the query than ours: the index would hand them out first
    const [itemB] = await db
      .insert(contentItems)
      .values({ nodeId: b, kind: 'markdown', title: 'Чужі', bodyMd: 'x' })
      .returning();
    const { vectors } = await provider.embed(['запит про бази']);
    await db.insert(contentChunks).values(
      Array.from({ length: 400 }, (_, i) => ({
        nodeId: b,
        contentItemId: itemB!.id,
        chunkIndex: i,
        text: 'чужий',
        tokenCount: 1,
        // the query vector nudged a little, differently each time
        embedding: vectors[0]!.map((x, d) => (d === i % 1024 ? x + 0.01 * (1 + (i % 7)) : x)),
      })),
    );
    // Without the node_id index and sequential scans the planner would walk the HNSW index and filter
    // afterwards, as it does on a big table; it only reaches the nearest candidates, all of node b.
    await db.execute(sql`DROP INDEX content_chunks_node_idx`);
    const noSeqScan = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL!,
      options: '-c enable_seqscan=off -c enable_bitmapscan=off',
    });
    try {
      const rows = await retrieve(drizzle(noSeqScan), client, {
        allowedNodeIds: [a],
        query: 'запит про бази',
        k: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.nodeId).toBe(a);
    } finally {
      await noSeqScan.end();
      await db.execute(sql`CREATE INDEX content_chunks_node_idx ON content_chunks (node_id)`);
    }
  });

  it('rejects bad input', async () => {
    const { client } = embedder();
    await expect(
      retrieve(db, client, { allowedNodeIds: ['nope'], query: 'q', k: 3 }),
    ).rejects.toThrow();
    await expect(retrieve(db, client, { allowedNodeIds: [], query: '', k: 3 })).rejects.toThrow();
    await expect(retrieve(db, client, { allowedNodeIds: [], query: 'q', k: 0 })).rejects.toThrow();
  });
});

describe('indexing', () => {
  const long = Array.from(
    { length: 40 },
    (_, i) => `Абзац ${i} про змінні та типи даних у Python.`,
  ).join('\n\n');

  it('is idempotent: running it again creates no chunks and calls no embedding model', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    await createContentItem(db, author, node, md('Довгий', long));
    const { client, provider } = embedder();

    const first = await indexNode(db, client, node);
    expect(first.indexed).toBe(1);
    expect(first.chunks).toBeGreaterThan(1);
    const before = (await chunkRows(node)).map((c) => c.id).sort();
    expect(before).toHaveLength(first.chunks);
    const calls = provider.calls.length;

    const second = await indexNode(db, client, node);
    expect(second).toEqual({ indexed: 0, skipped: 1, chunks: 0 });
    expect((await chunkRows(node)).map((c) => c.id).sort()).toEqual(before);
    expect(provider.calls.length).toBe(calls);
  });

  it('two concurrent runs leave one set of chunks', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    await createContentItem(db, author, node, md('Довгий', long));
    const { client } = embedder();
    const [x, y] = await Promise.all([indexNode(db, client, node), indexNode(db, client, node)]);
    expect(x.indexed + y.indexed).toBe(1);
    const rows = await chunkRows(node);
    expect(new Set(rows.map((r) => r.chunkIndex)).size).toBe(rows.length);
  });

  it('re-indexes only the node whose content changed', async () => {
    const { author, nodeIds } = await setup();
    const [a, b] = nodeIds as [string, string];
    const itemA = await createContentItem(db, author, a, md('А', 'Текст першого вузла про цикли.'));
    await createContentItem(db, author, b, md('Б', 'Текст другого вузла про функції.'));
    const { client, provider } = embedder();
    await indexNode(db, client, a);
    await indexNode(db, client, b);
    const bBefore = (await chunkRows(b)).map((c) => c.id);
    expect(await findStaleNodeIds(db).then((ids) => ids.filter((i) => i === a || i === b))).toEqual(
      [],
    );

    await updateContentItem(db, author, itemA.id, {
      bodyMd: 'Новий текст першого вузла про рекурсію.',
    });
    expect((await findStaleNodeIds(db)).filter((i) => i === a || i === b)).toEqual([a]);
    const calls = provider.calls.length;
    await indexNode(db, client, a);
    await indexNode(db, client, b);

    expect(provider.calls.length).toBe(calls + 1);
    expect(provider.calls.at(-1)!.join(' ')).toContain('рекурсію');
    expect((await chunkRows(b)).map((c) => c.id)).toEqual(bBefore);
    expect((await chunkRows(a)).map((c) => c.text).join(' ')).toContain('рекурсію');
    expect((await chunkRows(a)).map((c) => c.text).join(' ')).not.toContain('цикли');
  });

  it('removes chunks when the item loses its text or is deleted', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const item = await createContentItem(db, author, node, md('Т', 'Якийсь текст.'));
    const { client } = embedder();
    await indexNode(db, client, node);
    expect(await chunkRows(node)).toHaveLength(1);

    await updateContentItem(db, author, item.id, { bodyMd: '   ' });
    await indexNode(db, client, node);
    expect(await chunkRows(node)).toHaveLength(0);

    await updateContentItem(db, author, item.id, { bodyMd: 'Знову текст.' });
    await indexNode(db, client, node);
    expect(await chunkRows(node)).toHaveLength(1);
    await deleteContentItem(db, author, item.id);
    expect(await chunkRows(node)).toHaveLength(0);
  });

  it('logs embedding calls to llm_runs with hashes, not the chunk text', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const secret = 'унікальнийтекстдляперевірки';
    const item = await createContentItem(db, author, node, md('Лог', `Тут є ${secret}.`));
    const { client } = embedder();
    await indexNode(db, client, node);
    const runs = await db.select().from(llmRuns).where(eq(llmRuns.subjectId, item.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ purpose: 'embedding', model: 'mock-embedding-1' });
    expect(JSON.stringify(runs[0])).not.toContain(secret);
    expect(JSON.stringify(runs[0]!.request)).toMatch(/[0-9a-f]{64}/);
  });
});

describe('videos and transcripts', () => {
  it('a video without a transcript blocks publication validation until it has one', async () => {
    const { author, versionId, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const video = await createContentItem(db, author, node, {
      kind: 'video',
      title: 'Урок',
      videoUrl: 'https://example.com/lesson.mp4',
    });
    const issues = (await getVersionGraph(db, author, versionId)).issues;
    expect(issues).toEqual([
      expect.objectContaining({ code: 'video_without_transcript', nodeIds: [node] }),
    ]);

    await updateContentItem(db, author, video.id, { transcriptText: '   ' });
    expect((await getVersionGraph(db, author, versionId)).issues).toHaveLength(1);

    const fixed = await updateContentItem(db, author, video.id, { transcriptText: 'Текст уроку.' });
    expect(fixed).toMatchObject({ transcriptText: 'Текст уроку.', transcriptSource: 'author' });
    expect((await getVersionGraph(db, author, versionId)).issues).toEqual([]);
  });

  it('transcribes an uploaded video on the mock and indexes the transcript', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const dir = await mkdtemp(join(tmpdir(), 'eduforge-test-'));
    const { key } = await saveVideo(dir, [Buffer.from('\0\0\0\x18ftypmp42 fake video')]);
    const video = await createContentItem(db, author, node, {
      kind: 'video',
      title: 'Файл',
      videoStorageKey: key,
    });
    expect(await findUntranscribedItemIds(db)).toContain(video.id);

    const provider = new MockTranscriptionProvider();
    const transcriber = new TranscriptionClient(provider, new DrizzleLLMRunStore(db));
    expect(await transcribeItem(db, transcriber, dir, video.id)).toEqual({
      transcribed: true,
      nodeId: node,
    });
    const [row] = await db.select().from(contentItems).where(eq(contentItems.id, video.id));
    expect(row).toMatchObject({ transcriptSource: 'whisper' });
    expect(row!.transcriptText).toContain(key);
    const [run] = await db.select().from(llmRuns).where(eq(llmRuns.subjectId, video.id));
    expect(run).toMatchObject({ purpose: 'transcription', model: 'mock-whisper-1' });

    // a second run, and a video that already has a transcript, do nothing
    expect(await transcribeItem(db, transcriber, dir, video.id)).toEqual({ transcribed: false });
    expect(provider.calls).toHaveLength(1);
    expect(await findUntranscribedItemIds(db)).not.toContain(video.id);

    const { client } = embedder();
    await indexNode(db, client, node);
    expect((await chunkRows(node)).map((c) => c.text).join(' ')).toContain('транскрипція');
  });

  it("never overwrites an author's transcript", async () => {
    const { author, nodeIds } = await setup();
    const dir = await mkdtemp(join(tmpdir(), 'eduforge-test-'));
    const { key } = await saveVideo(dir, [Buffer.from('\0\0\0\x18ftypmp42 fake video')]);
    const video = await createContentItem(db, author, nodeIds[0]!, {
      kind: 'video',
      title: 'Файл',
      videoStorageKey: key,
      transcriptText: 'Авторський текст.',
    });
    const transcriber = new TranscriptionClient(
      new MockTranscriptionProvider(),
      new DrizzleLLMRunStore(db),
    );
    expect(await transcribeItem(db, transcriber, dir, video.id)).toEqual({ transcribed: false });
    const [row] = await db.select().from(contentItems).where(eq(contentItems.id, video.id));
    expect(row).toMatchObject({ transcriptText: 'Авторський текст.', transcriptSource: 'author' });
  });

  it('a failed transcription is logged and rethrown', async () => {
    const { author, nodeIds } = await setup();
    const dir = await mkdtemp(join(tmpdir(), 'eduforge-test-'));
    const { key } = await saveVideo(dir, [Buffer.from('\0\0\0\x18ftypmp42 fake video')]);
    const video = await createContentItem(db, author, nodeIds[0]!, {
      kind: 'video',
      title: 'Файл',
      videoStorageKey: key,
    });
    const broken = new TranscriptionClient(
      { model: 'broken', transcribe: async () => Promise.reject(new Error('boom')) },
      new DrizzleLLMRunStore(db),
    );
    await expect(transcribeItem(db, broken, dir, video.id)).rejects.toThrow('boom');
    const [run] = await db.select().from(llmRuns).where(eq(llmRuns.subjectId, video.id));
    expect(run).toMatchObject({ purpose: 'transcription', response: null });
    expect(run!.params).toMatchObject({ providerError: 'Error: boom' });
  });
});

describe('replacing a video file', () => {
  const mp4 = () => [Buffer.from('\0\0\0\x18ftypmp42 fake video')];

  async function whisperVideo() {
    const { author, nodeIds } = await setup();
    const dir = await mkdtemp(join(tmpdir(), 'eduforge-test-'));
    const a = await saveVideo(dir, mp4());
    const b = await saveVideo(dir, mp4());
    const video = await createContentItem(db, author, nodeIds[0]!, {
      kind: 'video',
      title: 'Файл',
      videoStorageKey: a.key,
    });
    const transcriber = new TranscriptionClient(
      new MockTranscriptionProvider(),
      new DrizzleLLMRunStore(db),
    );
    await transcribeItem(db, transcriber, dir, video.id);
    return { author, dir, video, transcriber, a: a.key, b: b.key };
  }

  it('drops the old Whisper transcript even when the editor sends it back unchanged', async () => {
    const { author, video, a, b } = await whisperVideo();
    const [before] = await db.select().from(contentItems).where(eq(contentItems.id, video.id));
    expect(before).toMatchObject({ transcriptSource: 'whisper', videoStorageKey: a });

    const after = await updateContentItem(db, author, video.id, {
      title: 'Файл',
      videoStorageKey: b,
      transcriptText: before!.transcriptText,
    });
    expect(after).toMatchObject({
      videoStorageKey: b,
      transcriptText: null,
      transcriptSource: null,
    });
    expect(await findUntranscribedItemIds(db)).toContain(video.id);
  });

  it("keeps an author's transcript when the file is replaced", async () => {
    const { author, video, b } = await whisperVideo();
    const after = await updateContentItem(db, author, video.id, {
      videoStorageKey: b,
      transcriptText: 'Тепер мій текст.',
    });
    expect(after).toMatchObject({ transcriptText: 'Тепер мій текст.', transcriptSource: 'author' });
  });

  it('a transcription that finishes after the file was swapped is not written', async () => {
    const { dir, video, b } = await whisperVideo();
    await db
      .update(contentItems)
      .set({ transcriptText: null, transcriptSource: null })
      .where(eq(contentItems.id, video.id));
    // the job read the item with file `a`; while Whisper works, the author swaps in file `b`
    const slow = new TranscriptionClient(
      {
        model: 'slow',
        transcribe: async () => {
          await db
            .update(contentItems)
            .set({ videoStorageKey: b })
            .where(eq(contentItems.id, video.id));
          return { text: 'Текст старого файлу', costUsd: 0 };
        },
      },
      new DrizzleLLMRunStore(db),
    );
    expect(await transcribeItem(db, slow, dir, video.id)).toEqual({ transcribed: false });
    const [row] = await db.select().from(contentItems).where(eq(contentItems.id, video.id));
    expect(row).toMatchObject({ videoStorageKey: b, transcriptText: null });
  });

  it('stops queueing an item after repeated transcription failures', async () => {
    const { video, dir } = await (async () => {
      const w = await whisperVideo();
      await db
        .update(contentItems)
        .set({ transcriptText: null, transcriptSource: null })
        .where(eq(contentItems.id, w.video.id));
      return w;
    })();
    const broken = new TranscriptionClient(
      { model: 'broken', transcribe: async () => Promise.reject(new Error('413')) },
      new DrizzleLLMRunStore(db),
    );
    for (let i = 0; i < 3; i++) {
      expect(await findUntranscribedItemIds(db)).toContain(video.id);
      await transcribeItem(db, broken, dir, video.id).catch(() => {});
    }
    expect(await findUntranscribedItemIds(db)).not.toContain(video.id);
  });
});

describe('storage', () => {
  it('accepts an mp4, rejects other files and oversized uploads, and serves only visible videos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eduforge-test-'));
    expect(await codeOf(saveVideo(dir, [Buffer.from('not a video at all')]))).toBe(
      'invalid_content',
    );
    expect(await codeOf(saveVideo(dir, [Buffer.alloc(0)]))).toBe('invalid_content');
    const mp4 = Buffer.from('\0\0\0\x18ftypmp42 0123456789');
    expect(await codeOf(saveVideo(dir, [mp4], 10))).toBe('invalid_content');

    const { key, size } = await saveVideo(dir, [mp4]);
    expect(size).toBe(mp4.length);

    const { author, versionId, nodeIds } = await setup();
    await createContentItem(db, author, nodeIds[0]!, {
      kind: 'video',
      title: 'В',
      videoStorageKey: key,
      transcriptText: 'т',
    });
    const student = await makeUser(['student']);
    expect((await getVideoFile(db, author, dir, key)).size).toBe(size);
    // the course is still a draft: a student does not see the video
    expect(await codeOf(getVideoFile(db, student, dir, key))).toBe('media_not_found');
    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));
    expect((await getVideoFile(db, student, dir, key)).size).toBe(size);
    // keys that are not ours never reach the file system
    expect(await codeOf(getVideoFile(db, student, dir, '../../etc/passwd'))).toBe(
      'media_not_found',
    );
    await writeFile(join(dir, 'x.mp4'), 'x');
    expect(await codeOf(getVideoFile(db, student, dir, 'x.mp4'))).toBe('media_not_found');
  });
});

describe('permissions and editing rules', () => {
  it('only the owner or an admin may edit; drafts are hidden from students', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const other = await makeUser(['author']);
    const student = await makeUser(['student']);
    const admin = await makeUser(['admin']);
    const item = await createContentItem(db, author, node, md('Т', 'текст'));

    expect(await codeOf(createContentItem(db, other, node, md('Х', 'х')))).toBe('course_not_found');
    expect(await codeOf(listNodeContent(db, student, node))).toBe('course_not_found');
    expect(await codeOf(updateContentItem(db, student, item.id, { title: 'Х' }))).toBe(
      'content_not_found',
    );
    expect(await codeOf(deleteContentItem(db, null, item.id))).toBe('unauthenticated');
    expect((await listNodeContent(db, admin, node)).canEdit).toBe(true);
    expect(await codeOf(updateContentItem(db, admin, item.id, { title: 'Нове' }))).toBe('none');

    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(
        inArray(courseVersions.id, sql`(select course_version_id from nodes where id = ${node})`),
      );
    const asStudent = await listNodeContent(db, student, node);
    expect(asStudent.canEdit).toBe(false);
    expect(asStudent.items).toHaveLength(1);
    expect(await codeOf(updateContentItem(db, student, item.id, { title: 'Х' }))).toBe('forbidden');
  });

  it('a published version is frozen: content cannot change', async () => {
    const { author, versionId, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const item = await createContentItem(db, author, node, md('Т', 'текст'));
    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));
    expect(await codeOf(createContentItem(db, author, node, md('Х', 'х')))).toBe('version_locked');
    expect(await codeOf(updateContentItem(db, author, item.id, { title: 'Х' }))).toBe(
      'version_locked',
    );
    expect(await codeOf(deleteContentItem(db, author, item.id))).toBe('version_locked');
    expect((await listNodeContent(db, author, node)).items[0]!.title).toBe('Т');
  });

  it('validates input and keeps the kind fixed', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    expect(await codeOf(createContentItem(db, author, node, { kind: 'video', title: 'В' }))).toBe(
      'invalid_content',
    );
    expect(
      await codeOf(
        createContentItem(db, author, node, {
          kind: 'video',
          title: 'В',
          videoUrl: 'javascript:alert(1)',
        }),
      ),
    ).toBe('invalid_content');
    expect(
      await codeOf(
        createContentItem(db, author, node, { kind: 'markdown', title: ' ', bodyMd: '' }),
      ),
    ).toBe('invalid_content');
    expect(await codeOf(createContentItem(db, author, node, { kind: 'audio' }))).toBe(
      'invalid_content',
    );
    expect(await codeOf(createContentItem(db, author, 'not-a-uuid', md('Т', 'т')))).toBe(
      'course_not_found',
    );

    const text = await createContentItem(db, author, node, md('Т', 'т'));
    const video = await createContentItem(db, author, node, {
      kind: 'video',
      title: 'В',
      videoUrl: 'https://example.com/v.mp4',
    });
    expect(
      await codeOf(
        updateContentItem(db, author, text.id, { videoUrl: 'https://example.com/x.mp4' }),
      ),
    ).toBe('invalid_content');
    expect(await codeOf(updateContentItem(db, author, video.id, { bodyMd: 'x' }))).toBe(
      'invalid_content',
    );
    expect(await codeOf(updateContentItem(db, author, video.id, { videoUrl: null }))).toBe(
      'invalid_content',
    );
    expect(await codeOf(updateContentItem(db, author, video.id, { kind: 'markdown' }))).toBe(
      'invalid_content',
    );
    expect(await codeOf(updateContentItem(db, author, video.id, {}))).toBe('invalid_content');
  });

  it('puts new items at the end and keeps whisper transcripts when only the title changes', async () => {
    const { author, nodeIds } = await setup();
    const node = nodeIds[0]!;
    const a = await createContentItem(db, author, node, md('А', 'а'));
    const b = await createContentItem(db, author, node, md('Б', 'б'));
    expect([a.ord, b.ord]).toEqual([0, 1]);
    const v = await createContentItem(db, author, node, {
      kind: 'video',
      title: 'В',
      videoUrl: 'https://example.com/v.mp4',
    });
    await db
      .update(contentItems)
      .set({ transcriptText: 'авто', transcriptSource: 'whisper' })
      .where(eq(contentItems.id, v.id));
    const same = await updateContentItem(db, author, v.id, { title: 'В2', transcriptText: 'авто' });
    expect(same).toMatchObject({ title: 'В2', transcriptSource: 'whisper' });
  });
});

describe('new versions', () => {
  it('copy content and chunks, so the new version is searchable without re-embedding', async () => {
    const { author, versionId, nodeIds } = await setup();
    const node = nodeIds[0]!;
    await createContentItem(
      db,
      author,
      node,
      md('Копія', 'Текст, який переїде у нову версію курсу.'),
    );
    const { client, provider } = embedder();
    await indexNode(db, client, node);
    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));

    const next = await createNewVersion(db, author, versionId);
    const graph = await getVersionGraph(db, author, next.versionId);
    const copied = graph.nodes.find(
      (x) => x.title === (demo.nodes as { title: string }[])[0]!.title,
    )!;
    expect(copied.id).not.toBe(node);
    const content = await listNodeContent(db, author, copied.id);
    expect(content.items).toHaveLength(1);
    expect(content.items[0]).toMatchObject({ title: 'Копія', indexed: true });

    const calls = provider.calls.length;
    const found = await retrieve(db, client, {
      allowedNodeIds: [copied.id],
      query: 'нову версію курсу',
      k: 3,
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.nodeId).toBe(copied.id);
    expect(provider.calls.length).toBe(calls + 1); // only the query was embedded
    expect(await findStaleNodeIds(db).then((ids) => ids.includes(copied.id))).toBe(false);
    // the old version keeps its own chunks
    expect(await chunkRows(node)).toHaveLength(1);
  });
});
