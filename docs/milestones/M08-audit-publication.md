# M08 — Audit, publication, author editors

**Depends on:** M02, M03, M04 · **SPEC requirements:** F4 (R1–R8), F1-R6, F11, D-06…D-10, D-09b

## Goal
The full path of a course from draft to publication: editors, an AI audit with two axes, the volume cap, and expert review of rating 10.

## Scope
- A visual graph editor (React Flow) and an editor for node content/skills.
- The audit pipeline (stages 0–3 per F4): structure → `volume_cap` → conformity gate → skill verification → scoring (N = 5 runs, median, all runs in `llm_runs`).
- The rating formula F4-R5 as a pure function with config; `final = min(ai_score, volume_cap)`.
- Version states and transitions (`draft → auditing → changes_requested | ready_to_publish | expert_review → published`).
- Author interface: score, level, hardness, per-category feedback, skill-verification result; a limit of 5 runs per version; thresholds are not shown.
- Expert review (simulated): an admin assigns an expert, a checklist, `approved`/`rejected`, a notification to the author; on rejection — a choice of "keep improving" or "publish with 9".
- Publication and immutability of versions; creating a new version from a published one.
- A course catalog that shows the rating to the student.

## Out of scope
Pairwise comparisons against anchors (OQ-9), real external experts.

## Acceptance criteria
- [ ] Formula unit tests: junior/middle/senior band edges, `cap` lowers the score, 10 sends the version to `expert_review`
- [ ] A course that does not match its description returns to `changes_requested` with a list of mismatches
- [ ] A declared but uncovered skill is flagged to the author
- [ ] A sixth audit run on a version is rejected
- [ ] The rating-10 review flow passes e2e: assignment → checklist → decision → notification
- [ ] A published version cannot be edited; a new version is created and goes through the audit again
- [ ] The student sees the rating in the catalog and on the course page

## Tests
Unit: formula, run median, states. Integration: the pipeline on the Mock with "good/weak/non-matching course" fixtures. e2e: the author and expert paths.
