# M00 — Project scaffold and infrastructure

**Depends on:** — · **SPEC requirements:** section 4, P1–P6, NFR-3, NFR-5, NFR-6

## Goal
A working monorepo with a database, a worker, an LLM layer and config, on which the modules can be built up.

## Scope
- Monorepo (pnpm workspaces): `apps/web` (Next.js App Router, TS), `apps/worker` (Node), `packages/db`, `packages/core`, `packages/llm`.
- `docker-compose` with PostgreSQL + pgvector; a migration tool (Drizzle recommended; the choice is recorded in an ADR); an empty initial migration that enables the `vector` extension.
- A configuration module (`zod`-validated env) with `TIME_SCALE` and the defaults from the SPEC (thresholds, pauses, intervals).
- `LLMProvider`: an interface (structured output against a Zod schema), `MockLLMProvider` (deterministic), caching, logging into `llm_runs` (the table is created here).
- `pg-boss` in the worker: a sample job and retries.
- Linter, formatter, Vitest, a Playwright skeleton, CI (GitHub Actions: lint, test, build).
- `.env.example`, a README with run instructions.

## Out of scope
Business tables (they appear in later milestones), real LLM providers (an adapter may be added, but tests run on the Mock).

## Acceptance criteria
- [ ] `docker compose up` + `pnpm dev` bring up web and worker on a clean machine
- [ ] Migrations apply to an empty DB and roll back
- [ ] `GET /api/health` checks the DB and the queue
- [ ] An `LLMProvider` call with the Mock returns a Zod-validated result and creates a row in `llm_runs`
- [ ] A test `pg-boss` job is executed by the worker and retried on failure
- [ ] `TIME_SCALE` changes the result of the "pause duration" function (unit test)
- [ ] CI is green

## Tests
Unit: config, `TIME_SCALE`, LLM cache. Integration: migrations, health, a worker job.

## Notes for the agent
The embedding dimension is an open question (OQ-2): put it in config, do not hardcode it.
