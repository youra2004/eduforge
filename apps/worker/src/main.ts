import { PgBoss } from 'pg-boss';
import {
  createEmbeddingClient,
  createLLMClient,
  createTranscriptionClient,
  loadConfig,
  recommendationSettings,
} from '@eduforge/core';
import { createDb } from '@eduforge/db';
import { registerAuditJobs } from './auditJobs';
import { registerContentJobs } from './contentJobs';
import { registerJobs } from './jobs';
import { registerProctorJobs } from './proctorJobs';
import { registerRecommendationJobs } from './recommendationJobs';
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
await registerAuditJobs(boss, { db, llm: createLLMClient(db) });
await registerProctorJobs(boss, { db, storageDir: config.storageDir });
await registerRecommendationJobs(boss, {
  db,
  llm: createLLMClient(db),
  settings: recommendationSettings(config),
});
console.log('[worker] started');

async function shutdown() {
  await boss.stop();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
