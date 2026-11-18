import { createDb } from '@eduforge/db';
import { seedDemo } from '../src/demo';
import { loadConfig } from '../src/config';

// Usage: DEMO_PASSWORD=... pnpm seed-demo    (DEMO_SUFFIX makes the emails and the course slug unique, for tests)
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error('Usage: DEMO_PASSWORD=... pnpm seed-demo');
  process.exit(1);
}

const { db, pool } = createDb(loadConfig().databaseUrl);
try {
  const result = await seedDemo(db, { password, suffix: process.env.DEMO_SUFFIX });
  if (!result.created) {
    console.log(`Demo data already exists (${result.adminEmail}); nothing changed.`);
  } else {
    console.log('Demonstration data created (marked as demo).');
    console.log(`  admin:    ${result.adminEmail}`);
    for (const e of result.studentEmails) console.log(`  student:  ${e}`);
  }
} catch (err) {
  console.error(err instanceof Error ? `Failed: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
