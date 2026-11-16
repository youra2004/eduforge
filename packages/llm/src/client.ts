import { createHash } from 'node:crypto';
import { z } from 'zod';
import { InMemoryLLMCache, type LLMCache } from './cache';
import type { LLMRunStore } from './store';
import type { LLMProvider, LLMRequest, LLMResult } from './types';

/**
 * The only entry point for LLM calls: validates output against the Zod schema (P3),
 * serves repeats from cache, and logs every call to llm_runs (NFR-3).
 */
export class LLMClient {
  constructor(
    private readonly provider: LLMProvider,
    private readonly store: LLMRunStore,
    private readonly cache: LLMCache = new InMemoryLLMCache(),
  ) {}

  async generate<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    const jsonSchema = z.toJSONSchema(req.schema);
    const params = req.params ?? {};
    const promptHash = createHash('sha256')
      .update(
        JSON.stringify({
          model: this.provider.model,
          promptVersion: req.promptVersion,
          system: req.system ?? null,
          prompt: req.prompt,
          params,
          jsonSchema,
        }),
      )
      .digest('hex');

    const base = {
      purpose: req.purpose,
      model: this.provider.model,
      promptVersion: req.promptVersion,
      promptHash,
      request: { system: req.system ?? null, prompt: req.prompt, schema: jsonSchema },
      subjectType: req.subject?.type,
      subjectId: req.subject?.id,
    };

    const useCache = req.cache !== false;
    if (useCache) {
      const hit = this.cache.get(promptHash);
      if (hit !== undefined) {
        const runId = await this.store.insert({
          ...base,
          params: { ...params, cached: true },
          response: hit,
        });
        return { data: hit as T, runId, cached: true };
      }
    }

    const started = performance.now();
    let result;
    try {
      result = await this.provider.complete(req);
    } catch (err) {
      // Failed calls are still calls: log them, then let the caller see the error.
      await this.store.insert({
        ...base,
        latencyMs: Math.round(performance.now() - started),
        params: { ...params, cached: false, providerError: String(err) },
        response: null,
      });
      throw err;
    }
    const latencyMs = Math.round(performance.now() - started);
    const usage = {
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      latencyMs,
    };

    const parsed = req.schema.safeParse(result.output);
    if (!parsed.success) {
      await this.store.insert({
        ...base,
        ...usage,
        params: { ...params, cached: false, validationError: z.prettifyError(parsed.error) },
        response: { raw: result.output ?? null },
      });
      throw new Error(`LLM output failed schema validation: ${z.prettifyError(parsed.error)}`);
    }

    const runId = await this.store.insert({
      ...base,
      ...usage,
      params: { ...params, cached: false },
      response: parsed.data,
    });
    if (useCache) this.cache.set(promptHash, parsed.data);
    return { data: parsed.data, runId, cached: false };
  }
}
