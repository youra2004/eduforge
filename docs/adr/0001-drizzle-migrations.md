# ADR-0001: Drizzle for schema and migrations

- Drizzle ORM + drizzle-kit (recommended by M00): typed schema, SQL migrations generated from it, no heavy runtime.
- drizzle-kit has no down migrations, so each `drizzle/NNNN_*.sql` has a hand-written `drizzle/down/NNNN_*.sql` used by `pnpm db:rollback`.
- The `vector` extension is enabled in migration 0000; the embedding dimension stays in config (OQ-2), not in the migration.
