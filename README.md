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

Authoring (M08): an author creates a course on `/author`, builds its graph in the visual editor on the course page, fills nodes with content and questions, and sends the version to the audit (the worker runs it, mock LLM by default). A rating of 10 waits for an expert that an admin assigns on `/admin`; the expert decides on `/expert`. Published versions are immutable: a change is a new version that is audited again. Tunables: `AUDIT_MAX_ATTEMPTS`, `AUDIT_SCORING_RUNS`, `AUDIT_VOLUME_CAPS`. The e2e audit tests need the worker running (`pnpm --filter @eduforge/worker start`).

Final exam (M09): once every node is passed, `/courses/<version>/exam` shows the rules and starts it; ratings, question limits, pass mark and pause are `EXAM_*` env vars (a week's pause lasts minutes with `TIME_SCALE`).

Proctoring (M10): the exam asks for the proctoring consent, then for the camera, light and fullscreen on the exam page; it is deterrence and evidence, not a guarantee. Hard events (leaving fullscreen, focus lost, copy/paste, devtools) stop the attempt and strike (7 d → 30 d → permanent, exams only); soft signals (faces, frame checks, typing rhythm) go to the admin queue at `/admin/strikes`, and every strike can be appealed. Frames are checked in memory and kept encrypted only when they trigger an event. Set `EVIDENCE_KEY` (`openssl rand -hex 32`) in `.env`; `PROCTOR_PROVIDER=mock` plays scenarios in demo mode (`/courses/<id>/exam?proctor=phone|second_person|other_face|gaze_away|no_face`). The worker deletes expired evidence daily. The e2e run uses Chromium's fake camera.

Certificate (M11): a passed exam gets a certificate signed with Ed25519 (course and version, rating, score, per-skill levels, an LLM description; no photo, no biometrics). Generate a key with `pnpm generate-signing-key` and put the `CERT_SIGNING_KEY=` line in `.env` (secret; without it nothing is issued). Anyone can open `/verify/<id>` (the QR code points there; Print saves a PDF), read `/api/certificates/<id>` and the public keys at `/.well-known/jwks.json`, and check the signature independently with `node scripts/verify-certificate.mjs <site url> <id>` (Node's crypto only). Admins revoke at `/admin/certificates` with a reason; a confirmed strike that annuls a pass revokes its certificate too.

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
