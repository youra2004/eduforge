import type { LLMPurpose } from '@eduforge/db';
import type { LLMProvider, LLMProviderResult, LLMRequest } from './types';

export type MockResponder = (req: LLMRequest) => unknown;

/** Deterministic provider for tests and demo: output depends only on the request. */
export class MockLLMProvider implements LLMProvider {
  readonly model = 'mock-1';
  readonly calls: LLMRequest[] = [];

  constructor(private readonly responders: Partial<Record<LLMPurpose, MockResponder>> = {}) {}

  async complete(req: LLMRequest): Promise<LLMProviderResult> {
    this.calls.push(req);
    const responder = this.responders[req.purpose];
    if (!responder) throw new Error(`MockLLMProvider has no responder for "${req.purpose}"`);
    const output = responder(req);
    return {
      output,
      tokensIn: Math.ceil(req.prompt.length / 4),
      tokensOut: Math.ceil(JSON.stringify(output).length / 4),
      costUsd: 0,
    };
  }
}
