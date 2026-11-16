import { createHash } from 'node:crypto';
import type { LLMRunStore } from './store';

export interface EmbeddingResult {
  vectors: number[][];
  tokens: number;
  costUsd: number;
}

/** Adapter interface for embedding models (P4). App code calls `EmbeddingClient`, not this. */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<EmbeddingResult>;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Deterministic bag-of-words embedder for tests and the demo: each word adds to one of `dim` buckets,
 * so texts that share words are close in cosine distance. Not a language model.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'mock-embedding-1';
  readonly calls: string[][] = [];

  constructor(readonly dim = 1024) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    this.calls.push(texts);
    const vectors = texts.map((t) => {
      const v = new Array<number>(this.dim).fill(0);
      for (const word of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        v[createHash('md5').update(word).digest().readUInt32BE(0) % this.dim]! += 1;
      }
      const norm = Math.hypot(...v);
      if (norm === 0) v[0] = 1; // an all-zero vector has no cosine distance
      return norm === 0 ? v : v.map((x) => x / norm);
    });
    return { vectors, tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0), costUsd: 0 };
  }
}

/** OpenAI-compatible `/embeddings` endpoint. `dimensions` is sent so the output matches the column size. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly opts: { apiKey: string; model: string; dim: number; baseUrl?: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get model() {
    return this.opts.model;
  }
  get dim() {
    return this.opts.dim;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const res = await this.fetchFn(
      `${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/embeddings`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ model: this.opts.model, input: texts, dimensions: this.opts.dim }),
      },
    );
    if (!res.ok) throw new Error(`Embedding request failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
      usage?: { total_tokens?: number };
    };
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { vectors, tokens: body.usage?.total_tokens ?? 0, costUsd: 0 };
  }
}

/**
 * The only entry point for embedding calls. Every call is logged to llm_runs (NFR-3), but only with
 * hashes and sizes: chunk text and vectors stay out of the log.
 */
export class EmbeddingClient {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly store: LLMRunStore,
  ) {}

  get dim() {
    return this.provider.dim;
  }

  async embed(texts: string[], subject?: { type: string; id: string }) {
    const inputs = texts.map((t) => ({ sha256: sha256(t), chars: t.length }));
    const base = {
      purpose: 'embedding' as const,
      model: this.provider.model,
      promptVersion: 'embed-v1',
      promptHash: sha256(JSON.stringify(inputs.map((i) => i.sha256))),
      request: { inputs },
      subjectType: subject?.type,
      subjectId: subject?.id,
    };
    const started = performance.now();
    let result: EmbeddingResult;
    try {
      result = await this.provider.embed(texts);
      if (
        result.vectors.length !== texts.length ||
        result.vectors.some((v) => v.length !== this.provider.dim)
      ) {
        throw new Error(
          `Embedding provider did not return ${texts.length} vectors of ${this.provider.dim} numbers`,
        );
      }
    } catch (err) {
      await this.store.insert({
        ...base,
        latencyMs: Math.round(performance.now() - started),
        params: { providerError: String(err) },
        response: null,
      });
      throw err;
    }
    const runId = await this.store.insert({
      ...base,
      tokensIn: result.tokens,
      costUsd: String(result.costUsd),
      latencyMs: Math.round(performance.now() - started),
      params: { dim: this.provider.dim },
      response: { count: result.vectors.length, dim: this.provider.dim },
    });
    return { vectors: result.vectors, runId };
  }
}
