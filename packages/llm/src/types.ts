import type { z } from 'zod';
import type { LLMPurpose } from '@eduforge/db';

export interface LLMRequest<T = unknown> {
  purpose: LLMPurpose;
  /** Bump when the prompt text changes; stored in llm_runs and part of the cache key. */
  promptVersion: string;
  system?: string;
  prompt: string;
  /** The output must validate against this schema (P3). */
  schema: z.ZodType<T>;
  params?: Record<string, unknown>;
  /** Set false for calls that must never be served from cache (e.g. N=5 audit runs). */
  cache?: boolean;
  subject?: { type: string; id: string };
}

/** What a provider adapter returns: unvalidated output plus usage. */
export interface LLMProviderResult {
  output: unknown;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Adapter interface for concrete providers (P4). App code calls `LLMClient`, not this. */
export interface LLMProvider {
  readonly model: string;
  complete(req: LLMRequest): Promise<LLMProviderResult>;
}

export interface LLMResult<T> {
  data: T;
  runId: string;
  cached: boolean;
}
