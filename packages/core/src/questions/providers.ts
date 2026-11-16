import type { Db } from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient } from '@eduforge/llm';
import { createQuestionMock } from './mock';

/** The one LLM entry point for app code (ADR-0002). Only the Mock exists until a real provider is chosen (OQ-1). */
export function createLLMClient(db: Db) {
  return new LLMClient(createQuestionMock(), new DrizzleLLMRunStore(db));
}
