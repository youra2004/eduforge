import { migrateDown, migrateUp } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const [command, arg] = process.argv.slice(2);
if (command === 'up') {
  await migrateUp(url);
  console.log('migrations applied');
} else if (command === 'down') {
  const rolledBack = await migrateDown(url, arg ? Number(arg) : 1);
  console.log(`rolled back: ${rolledBack.join(', ') || 'nothing'}`);
} else {
  throw new Error('usage: migrate.ts up | down [steps]');
}
