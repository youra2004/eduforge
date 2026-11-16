# M12 — Recommendations and demo mode

**Depends on:** M05 · **SPEC requirements:** F7 (R1–R3), D-16, D-32, NFR-6

## Goal
Personal tips on the dashboard and a demo mode that is ready to show.

## Scope
- A daily job: SQL metrics for 7 and 30 days (mastery trend, weak skills, missed activities, failures).
- One LLM call per user per day, up to 3 tips; skipped when nothing changed; no spam.
- Table `recommendations`; display on the student dashboard.
- Demo mode: `TIME_SCALE` (pauses/intervals in minutes), a seed script (courses, users, histories), an admin "run job now" button.
- Seed data is **clearly marked** as demonstration data.

## Out of scope
Email/push notifications, spaced repetition.

## Acceptance criteria
- [ ] Tips are ≤ 3 per user per day
- [ ] When nothing has changed, no new tip is created
- [ ] The seed script produces a working demo environment from a clean DB
- [ ] In demo mode pauses shrink according to `TIME_SCALE`
- [ ] The "run now" button starts the job and shows the result

## Tests
Unit: metrics on fixtures. Integration: the job on the Mock. e2e: the demo scenario.
