# M05 — Learning engine (BKT, gating)

**Depends on:** M04 · **SPEC requirements:** F5 (R1–R7), D-11, D-12, D-14, P1, P2, P5

## Goal
Node tests, per-skill mastery via BKT, node unlocking, attempt rounds and pauses.

## Scope
- Pure BKT functions (`update(p, correct, guess, slip, learn)`), parameters from config.
- Tables: `enrollments`, `node_progress`, `skill_mastery`, `mastery_history`, `assessments`, `assessment_items`.
- Node-test assembly: ≥3 questions per skill from the `node` pool, unseen questions first.
- Pass rule: after the test, all of the node's skills have `p_known ≥ 0.80`.
- A round = 2 attempts; after the second failure a `NODE_COOLDOWN` pause (with `TIME_SCALE`); state `cooldown`.
- Unlocking by AND prerequisites; access to `locked` nodes is blocked **on the server**.
- `practice` mode: questions with no effect on BKT or progress.
- Student UI: a course page with node states, taking a test, the result, a hint about the pause.
- Events into `event_log` (P5) and writes into `mastery_history`.

## Out of scope
The tutor (M06), the exam (M09), recommendations (M12), skill decay.

## Acceptance criteria
- [ ] BKT unit tests on known numbers (with the defaults: two correct answers in a row from `p=0.20`, `guess=0.25` give ≈ 0.84)
- [ ] The pause cannot be bypassed from the client; a test with a faked clock confirms `cooldown`
- [ ] A `locked` node is not reachable through the API
- [ ] Practice exercises do not change `skill_mastery`
- [ ] Every answer has a row in `assessment_items`, every change of `p_known` has a row in `mastery_history`

## Tests
Unit: BKT, test assembly, the pass rule, states. Integration: rounds/pauses on a fake clock. e2e: passing a node from start to unlocking the next one.
