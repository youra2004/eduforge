import { PgBoss } from 'pg-boss';
import { createEmbeddingClient, createTranscriptionClient, loadConfig } from '@eduforge/core';
import { createDb } from '@eduforge/db';
import { registerContentJobs } from './contentJobs';
import { registerJobs } from './jobs';

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
console.log('[worker] started');

async function shutdown() {
  await boss.stop();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
