# EduForge — agent rules

Master's thesis project: a graph-based learning platform (mastery gating, AI tutor, exam, certificate). Goal: a working app fast. Build the core first (M00–M07), then the rest.

## Read first
`docs/SPEC.md` is the source of truth. Also read the current `docs/milestones/Mxx-*.md`, and `DATA_MODEL.md` / `RESEARCH.md` when relevant. If the SPEC is unclear or contradicts the code, stop and ask. Don't change it silently.

## Keep it simple
A simple change gets simple code. No extra abstractions, no features outside the milestone, nothing from the SPEC's "Out of scope". Business logic lives in `packages/core`; UI stays thin.

## Must-haves
- The server is the authority (timers, grades, strikes).
- Every LLM call goes through `LLMProvider`, is logged to `llm_runs`, and has a Mock.
- The tutor never sees answer keys or the exam pool.
- Never invent research results: use real logs or clearly labeled synthetic data.

## Done means verified
"Done" means you ran it and saw it work in this session, not "should work". If you couldn't check something, say so plainly. Quote real output (pass counts, curl response).

## Testing (keep it light, about 40% of the effort)
- Unit tests only for core logic: BKT, graph validator, rating formula, pass rules, tutor scope filter, timers, certificate signing.
- Backend change: unit tests + one real call (curl) to the locally running app.
- UI change: open it in a real browser (Playwright), take a screenshot of the main flow and look at it. Full e2e only for 2–3 key flows (node test, exam, certificate verification).
- Before finishing run lint, typecheck and tests for what you touched (`pnpm lint && pnpm typecheck && pnpm test`, scripts from M00).
- For critical logic (tutor scope, server timers, signature), check once that the test really fails when you break the logic, then revert.
- Never weaken, skip or delete a test to make it pass. If a test also fails on clean main, say so.

## Git
One branch per milestone (`mXX-name`), small commits that reference IDs (`F5-R3`, `D-14`). Commit on the task branch only. Never force-push, never merge, never commit `.env*`, keys or test output. Push and open PRs only when asked.

## Conventions
- Docs, code and commits in English; product UI and course content in Ukrainian.
- Migrations only through the migration tool. Secrets only in env.
- Decisions the SPEC left to you: 3 lines in `docs/adr/`.
- Stop any dev server you started before handing off.

## Hand-off
Say what's done, what you verified (with real output), what you couldn't check, and what's deferred.
