import type { Db } from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient, MockLLMProvider } from '@eduforge/llm';
import { auditMockResponders } from '../audit/mock';
import { certificateMockResponders } from '../certificate/summary';
import { tutorMockResponders } from '../tutor/mock';
import { questionMockResponders } from './mock';

/** The one LLM entry point for app code (ADR-0002). Only the Mock exists until a real provider is chosen (OQ-1). */
export function createLLMClient(db: Db) {
  const mock = new MockLLMProvider({
    ...questionMockResponders,
    ...tutorMockResponders,
    ...auditMockResponders,
    ...certificateMockResponders,
  });
  return new LLMClient(mock, new DrizzleLLMRunStore(db));
}
