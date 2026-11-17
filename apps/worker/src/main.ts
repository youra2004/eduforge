import { PgBoss } from 'pg-boss';
import {
  createEmbeddingClient,
  createLLMClient,
  createTranscriptionClient,
  loadConfig,
} from '@eduforge/core';
import { createDb } from '@eduforge/db';
import { registerContentJobs } from './contentJobs';
import { registerJobs } from './jobs';
import { registerQuestionJobs } from './questionJobs';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const boss = new PgBoss(config.databaseUrl);
boss.on('error', (err) => console.error('[worker] pg-boss error', err));

await boss.start();
await registerJobs(boss);
await registerContentJobs(boss, {
  db,
  embedder: createEmbeddingClient(db, config),
  transcriber: createTranscriptionClient(db, config),
  storageDir: config.storageDir,
});
await registerQuestionJobs(boss, {
  db,
  llm: createLLMClient(db),
  slip: config.bkt.slip,
});
console.log('[worker] started');

async function shutdown() {
  await boss.stop();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
