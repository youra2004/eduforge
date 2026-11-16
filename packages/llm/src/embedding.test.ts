import { describe, expect, it } from 'vitest';
import type { NewLLMRun } from '@eduforge/db';
import { EmbeddingClient, MockEmbeddingProvider, OpenAIEmbeddingProvider } from './embedding';
import type { LLMRunStore } from './store';
import {
  MockTranscriptionProvider,
  WHISPER_MAX_BYTES,
  TranscriptionClient,
  WhisperTranscriptionProvider,
} from './transcription';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class MemoryStore implements LLMRunStore {
  runs: NewLLMRun[] = [];
  async insert(run: NewLLMRun) {
    this.runs.push(run);
    return `run-${this.runs.length}`;
  }
}

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe('MockEmbeddingProvider', () => {
  const mock = new MockEmbeddingProvider(64);

  it('is deterministic, unit length, and puts texts with shared words closer', async () => {
    const { vectors } = await mock.embed([
      'цикл for перебирає елементи списку',
      'цикл for перебирає елементи списку',
      'елементи списку та цикл',
      'бази даних і SQL запити',
    ]);
    expect(vectors[0]).toEqual(vectors[1]);
    expect(Math.hypot(...vectors[0]!)).toBeCloseTo(1);
    expect(cosine(vectors[0]!, vectors[2]!)).toBeGreaterThan(cosine(vectors[0]!, vectors[3]!));
  });

  it('gives text without words a valid, non-zero vector', async () => {
    const { vectors } = await mock.embed(['', '...']);
    for (const v of vectors) expect(Math.hypot(...v)).toBeCloseTo(1);
  });
});

describe('EmbeddingClient', () => {
  it('logs the call to llm_runs with hashes and sizes, not the text or the vectors', async () => {
    const store = new MemoryStore();
    const client = new EmbeddingClient(new MockEmbeddingProvider(8), store);
    const { vectors, runId } = await client.embed(['секретний текст'], {
      type: 'content_item',
      id: 'x',
    });
    expect(vectors).toHaveLength(1);
    expect(runId).toBe('run-1');
    const [run] = store.runs;
    expect(run).toMatchObject({
      purpose: 'embedding',
      model: 'mock-embedding-1',
      subjectType: 'content_item',
      response: { count: 1, dim: 8 },
    });
    expect(JSON.stringify(run)).not.toContain('секретний');
    expect(run!.request).toEqual({
      inputs: [{ sha256: expect.stringMatching(/^[0-9a-f]{64}$/), chars: 15 }],
    });
  });

  it('logs a provider failure and rethrows it', async () => {
    const store = new MemoryStore();
    const client = new EmbeddingClient(
      { model: 'bad', dim: 4, embed: async () => Promise.reject(new Error('down')) },
      store,
    );
    await expect(client.embed(['a'])).rejects.toThrow('down');
    expect(store.runs[0]).toMatchObject({
      response: null,
      params: { providerError: 'Error: down' },
    });
  });

  it('rejects vectors of the wrong size, and logs that too', async () => {
    const store = new MemoryStore();
    const client = new EmbeddingClient(
      { model: 'bad', dim: 4, embed: async () => ({ vectors: [[1, 2]], tokens: 1, costUsd: 0 }) },
      store,
    );
    await expect(client.embed(['a'])).rejects.toThrow(/did not return 1 vectors of 4/);
    expect(store.runs).toHaveLength(1);
  });
});

describe('OpenAIEmbeddingProvider', () => {
  it('posts to /embeddings with dimensions and returns vectors in input order', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
        usage: { total_tokens: 7 },
      });
    }) as unknown as typeof fetch;
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'k', model: 'm', dim: 2 }, fakeFetch);
    const res = await provider.embed(['a', 'b']);
    expect(res).toEqual({
      vectors: [
        [1, 0],
        [0, 1],
      ],
      tokens: 7,
      costUsd: 0,
    });
    expect(seen!.url).toBe('https://api.openai.com/v1/embeddings');
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      model: 'm',
      input: ['a', 'b'],
      dimensions: 2,
    });
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('throws on an HTTP error', async () => {
    const provider = new OpenAIEmbeddingProvider(
      { apiKey: 'k', model: 'm', dim: 2 },
      (async () => new Response('no', { status: 429 })) as unknown as typeof fetch,
    );
    await expect(provider.embed(['a'])).rejects.toThrow('HTTP 429');
  });
});

describe('transcription', () => {
  it('the mock needs no file and the client logs size and hash, not the text', async () => {
    const store = new MemoryStore();
    const client = new TranscriptionClient(new MockTranscriptionProvider(), store);
    const { text } = await client.transcribe('/nowhere/lesson.mp4', {
      type: 'content_item',
      id: 'x',
    });
    expect(text).toContain('lesson.mp4');
    expect(store.runs[0]).toMatchObject({ purpose: 'transcription', model: 'mock-whisper-1' });
    expect(JSON.stringify(store.runs[0])).not.toContain('Автоматична');
    expect(store.runs[0]!.response).toEqual({ chars: text.length, sha256: expect.any(String) });
  });

  it('the Whisper adapter uploads the file to /audio/transcriptions', async () => {
    const file = join(tmpdir(), `whisper-test-${Date.now()}.mp4`);
    writeFileSync(file, 'bytes');
    let body: FormData | undefined;
    let url = '';
    const fakeFetch = (async (u: string, init: RequestInit) => {
      url = u;
      body = init.body as FormData;
      return Response.json({ text: 'привіт' });
    }) as unknown as typeof fetch;
    const provider = new WhisperTranscriptionProvider(
      { apiKey: 'k', model: 'whisper-1' },
      fakeFetch,
    );
    expect((await provider.transcribe(file)).text).toBe('привіт');
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(body!.get('model')).toBe('whisper-1');
    expect((body!.get('file') as File).size).toBe(5);
  });

  it('refuses a file over the Whisper size limit without uploading it', async () => {
    const file = join(tmpdir(), `whisper-big-${Date.now()}.mp4`);
    writeFileSync(file, Buffer.alloc(WHISPER_MAX_BYTES + 1));
    let called = false;
    const provider = new WhisperTranscriptionProvider(
      { apiKey: 'k', model: 'whisper-1' },
      (async () => {
        called = true;
        return Response.json({ text: 'x' });
      }) as unknown as typeof fetch,
    );
    await expect(provider.transcribe(file)).rejects.toThrow(/25 MB/);
    expect(called).toBe(false);
  });

  it('logs an empty transcript as a failure', async () => {
    const store = new MemoryStore();
    const client = new TranscriptionClient(
      { model: 'quiet', transcribe: async () => ({ text: '  ', costUsd: 0 }) },
      store,
    );
    await expect(client.transcribe('/x/silent.mp4')).rejects.toThrow('empty');
    expect(store.runs[0]).toMatchObject({ response: null });
  });
});
