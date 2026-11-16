import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import type { LLMRunStore } from './store';

export interface TranscriptionResult {
  text: string;
  costUsd: number;
}

/** Adapter interface for speech-to-text (P4). App code calls `TranscriptionClient`, not this. */
export interface TranscriptionProvider {
  readonly model: string;
  transcribe(filePath: string): Promise<TranscriptionResult>;
}

/** Deterministic stand-in: the text depends only on the file name, and the file need not exist. */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly model = 'mock-whisper-1';
  readonly calls: string[] = [];

  async transcribe(filePath: string): Promise<TranscriptionResult> {
    this.calls.push(filePath);
    return { text: `Автоматична транскрипція відео ${basename(filePath)}.`, costUsd: 0 };
  }
}

/** OpenAI-compatible `/audio/transcriptions` endpoint (Whisper). The API caps uploads at 25 MB. */
export class WhisperTranscriptionProvider implements TranscriptionProvider {
  constructor(
    private readonly opts: { apiKey: string; model: string; baseUrl?: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get model() {
    return this.opts.model;
  }

  async transcribe(filePath: string): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set('model', this.opts.model);
    form.set('response_format', 'json');
    form.set('file', await openAsBlob(filePath), basename(filePath));
    const res = await this.fetchFn(
      `${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`,
      { method: 'POST', headers: { authorization: `Bearer ${this.opts.apiKey}` }, body: form },
    );
    if (!res.ok) throw new Error(`Transcription request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { text?: string };
    if (typeof body.text !== 'string') throw new Error('Transcription response has no text');
    return { text: body.text, costUsd: 0 };
  }
}

/** The only entry point for transcription. Logged to llm_runs (NFR-3) with sizes and a hash, not the text. */
export class TranscriptionClient {
  constructor(
    private readonly provider: TranscriptionProvider,
    private readonly store: LLMRunStore,
  ) {}

  async transcribe(filePath: string, subject?: { type: string; id: string }) {
    const base = {
      purpose: 'transcription' as const,
      model: this.provider.model,
      promptVersion: 'transcribe-v1',
      promptHash: createHash('sha256').update(basename(filePath)).digest('hex'),
      request: { file: basename(filePath) },
      subjectType: subject?.type,
      subjectId: subject?.id,
    };
    const started = performance.now();
    let result: TranscriptionResult;
    try {
      result = await this.provider.transcribe(filePath);
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
      costUsd: String(result.costUsd),
      latencyMs: Math.round(performance.now() - started),
      response: {
        chars: result.text.length,
        sha256: createHash('sha256').update(result.text).digest('hex'),
      },
    });
    return { text: result.text, runId };
  }
}
