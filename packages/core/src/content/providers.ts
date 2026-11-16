import { EMBEDDING_COLUMN_DIM, type Db } from '@eduforge/db';
import {
  DrizzleLLMRunStore,
  EmbeddingClient,
  MockEmbeddingProvider,
  MockTranscriptionProvider,
  OpenAIEmbeddingProvider,
  TranscriptionClient,
  WhisperTranscriptionProvider,
} from '@eduforge/llm';
import type { Config } from '../config';

export function createEmbeddingClient(db: Db, config: Config) {
  if (config.embeddingDim !== EMBEDDING_COLUMN_DIM) {
    throw new Error(
      `EMBEDDING_DIM=${config.embeddingDim} does not match the content_chunks.embedding column (${EMBEDDING_COLUMN_DIM}); changing it needs a migration and a re-embed.`,
    );
  }
  const provider =
    config.embedding.provider === 'openai'
      ? new OpenAIEmbeddingProvider({
          apiKey: config.openaiApiKey!,
          model: config.embedding.model,
          dim: config.embeddingDim,
        })
      : new MockEmbeddingProvider(config.embeddingDim);
  return new EmbeddingClient(provider, new DrizzleLLMRunStore(db));
}

export function createTranscriptionClient(db: Db, config: Config) {
  const provider =
    config.transcription.provider === 'openai'
      ? new WhisperTranscriptionProvider({
          apiKey: config.openaiApiKey!,
          model: config.transcription.model,
        })
      : new MockTranscriptionProvider();
  return new TranscriptionClient(provider, new DrizzleLLMRunStore(db));
}
