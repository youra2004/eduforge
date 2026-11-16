import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createDb } from './client';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

type JournalEntry = { idx: number; when: number; tag: string };

function readJournal(): JournalEntry[] {
  const raw = readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

/** Applies all pending migrations. */
export async function migrateUp(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/**
 * Rolls back the last `steps` applied migrations using drizzle/down/<tag>.sql.
 * drizzle-kit has no down migrations, so each one is hand-written next to the up file.
 */
export async function migrateDown(databaseUrl: string, steps = 1): Promise<string[]> {
  const journal = readJournal();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const rolledBack: string[] = [];
  try {
    const table = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS t");
    if (!table.rows[0]?.t) return rolledBack;
    for (let i = 0; i < steps; i++) {
      const last = await pool.query<{ id: number; created_at: string }>(
        'SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
      );
      const row = last.rows[0];
      if (!row) break;
      const entry = journal.find((e) => e.when === Number(row.created_at));
      if (!entry) throw new Error(`No journal entry for applied migration ${row.created_at}`);
      const downSql = readFileSync(join(migrationsFolder, 'down', `${entry.tag}.sql`), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(downSql);
        await client.query('DELETE FROM drizzle.__drizzle_migrations WHERE id = $1', [row.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      rolledBack.push(entry.tag);
    }
  } finally {
    await pool.end();
  }
  return rolledBack;
}
