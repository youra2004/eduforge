import pg from 'pg';

export interface Health {
  ok: boolean;
  db: { ok: boolean; error?: string };
  queue: { ok: boolean; error?: string };
}

/** Checks Postgres is reachable and the pg-boss schema has been installed by the worker. */
export async function checkHealth(databaseUrl: string): Promise<Health> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  const health: Health = { ok: false, db: { ok: false }, queue: { ok: false } };
  try {
    try {
      await client.connect();
      await client.query('SELECT 1');
      health.db.ok = true;
    } catch (err) {
      health.db.error = err instanceof Error ? err.message : String(err);
      return health;
    }
    const res = await client.query<{ installed: string | null }>(
      "SELECT to_regclass('pgboss.job') AS installed",
    );
    if (res.rows[0]?.installed) health.queue.ok = true;
    else health.queue.error = 'pg-boss schema not installed (is the worker running?)';
  } catch (err) {
    health.queue.error = err instanceof Error ? err.message : String(err);
  } finally {
    await client.end().catch(() => {});
  }
  health.ok = health.db.ok && health.queue.ok;
  return health;
}
