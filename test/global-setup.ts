import pg from 'pg';
import { migrateUp } from '../packages/db/src/migrate';

/** Creates a throwaway eduforge_test database so tests never touch dev data. */
export default async function setup() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

  const admin = new URL(base);
  admin.pathname = '/postgres';
  const testUrl = new URL(base);
  testUrl.pathname = '/eduforge_test';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query('DROP DATABASE IF EXISTS eduforge_test WITH (FORCE)');
    await client.query('CREATE DATABASE eduforge_test');
  } finally {
    await client.end();
  }

  process.env.TEST_DATABASE_URL = testUrl.toString();
  await migrateUp(testUrl.toString());
}
