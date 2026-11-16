import { createDb } from '@eduforge/db';
import { createAdmin } from '../src/auth';
import { loadConfig } from '../src/config';

// Usage: pnpm create-admin <email> [display name]    (password from ADMIN_PASSWORD, or the 3rd arg)
const [email, displayName = 'Admin', passwordArg] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? passwordArg;
if (!email || !password) {
  console.error('Usage: ADMIN_PASSWORD=... pnpm create-admin <email> [display name]');
  process.exit(1);
}

const { db, pool } = createDb(loadConfig().databaseUrl);
try {
  const { created } = await createAdmin(db, { email, password, displayName });
  console.log(created ? `Created admin ${email}` : `${email} already exists; admin role ensured`);
} catch (err) {
  console.error(err instanceof Error ? `Failed: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
