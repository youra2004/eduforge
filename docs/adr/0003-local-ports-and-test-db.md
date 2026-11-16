# ADR-0003: Local ports and test database

- Compose publishes Postgres on host port 5433 (`POSTGRES_PORT`) so it does not clash with a local Postgres on 5432.
- `pnpm test` creates a throwaway `eduforge_test` database next to the dev one, migrates it, and points integration tests at it via `TEST_DATABASE_URL`.
- The worker owns pg-boss schema installation; `/api/health` reports the queue as down until the worker has started once.
