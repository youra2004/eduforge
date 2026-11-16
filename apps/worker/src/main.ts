import { PgBoss } from 'pg-boss';
import { loadConfig } from '@eduforge/core';
import { registerJobs } from './jobs';

const config = loadConfig();
const boss = new PgBoss(config.databaseUrl);
boss.on('error', (err) => console.error('[worker] pg-boss error', err));

await boss.start();
await registerJobs(boss);
console.log('[worker] started');

async function shutdown() {
  await boss.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
