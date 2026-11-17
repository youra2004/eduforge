# EduForge

Graph-based learning platform (mastery gating, AI tutor, exam, certificate). See `docs/SPEC.md` for the spec and `docs/milestones/` for the build plan.

## Requirements

Node 22+, pnpm 12 (`corepack enable`), Docker.

## Run locally

```bash
cp .env.example .env
pnpm install
docker compose up -d --wait   # Postgres + pgvector on localhost:5433
pnpm db:migrate               # apply migrations (pnpm db:rollback undoes the last one)
pnpm dev                      # web on :3000, worker alongside
```

Create the first admin (roles are assigned from the admin page afterwards):

```bash
ADMIN_PASSWORD='choose-a-password' pnpm create-admin you@example.com "Your Name"
```

Import a course (the seed is a small Ukrainian demo course; the author must already exist):

```bash
pnpm import-course packages/core/seed/demo-course.json author@example.com
```

Study demo (M07): `pnpm seed-experiment author@example.com` imports and publishes the two demo topics (slugs `EXPERIMENT_COURSE_A/B`). Students join on `/experiment`; the admin page exports de-identified CSVs for `analysis/` (see `analysis/README.md`).

Node content (text and video) is edited on the node page, opened from the course graph. Uploaded videos go to `STORAGE_DIR`; embeddings and transcripts are made by the worker (mock providers by default, see `.env.example`).

Check it: `curl localhost:3000/api/health` returns `{"ok":true,...}` once the worker has started.
Port busy? `PORT=3100 pnpm dev`.

## Layout

| Path            | What                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web`      | Next.js App Router (UI + short API routes)                                                                  |
| `apps/worker`   | Node worker running pg-boss jobs                                                                            |
| `packages/db`   | Drizzle schema, migrations (with rollbacks), health check                                                   |
| `packages/core` | Business logic and the zod-validated config                                                                 |
| `packages/llm`  | `LLMProvider`, `LLMClient` (cache, `llm_runs` logging), embedding and transcription clients, all with Mocks |

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` (needs Postgres up) · `pnpm test:e2e` (needs `pnpm exec playwright install chromium` once) · `pnpm build`

## Configuration

All settings are env vars, validated in `packages/core/src/config.ts`; `.env.example` lists them with SPEC defaults.
`TIME_SCALE` divides pauses and intervals for demos (`TIME_SCALE=1440` turns the 24 h node pause into 60 s).
