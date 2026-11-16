# M07 — Experiment instrumentation

**Depends on:** M05, M06 · **SPEC requirements:** D-29, D-30, D-31, D-33, P5 · **Source:** `RESEARCH.md`

## Goal
Everything needed to run the study: participants, conditions, tests, questionnaires, logging and export.

## Scope
- Tables `experiment_participants`, `experiment_assignments`; pseudonym `code`.
- A consent flow (`consents`, kind=`research`) before participation.
- Counterbalancing: assigning the `method`/`control` conditions and the topic order (`A_then_B`/`B_then_A`).
- **Control condition:** the same content and self-check questions, free navigation, no gating, no tutor (enforced on the server).
- **Pre-test, post-test and delayed post-test** flows from the `assessment` pool; a reminder for the delayed test.
- Short questionnaires (Likert scale) after each module.
- The full `event_log` event set from `RESEARCH.md` (§3), including `session_heartbeat` for learning time.
- CSV export by pseudonym, without email and names.
- An analysis skeleton in `analysis/` (Python notebook/scripts): load the export, normalized gain, paired tests, effect size.

## Out of scope
Proctoring in the experiment (switched off), the audit, the certificate.

## Acceptance criteria
- [ ] A counterbalancing unit test: with N participants, conditions and order are split evenly
- [ ] In the control condition the tutor and gating are unavailable (server-side test)
- [ ] The control and the "method" module use the **same** set of assessment questions
- [ ] The export contains no PII (automatic column check)
- [ ] All events from the list in `RESEARCH.md` §3 are actually written (checklist test)
- [ ] The analysis script runs on a synthetic dataset with a fixed seed and labels it as synthetic

## Tests
Unit: counterbalancing, gain computation. Integration: test flows, export. e2e: a participant completes a module in both conditions.
