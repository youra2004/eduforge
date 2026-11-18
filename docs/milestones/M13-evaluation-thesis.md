# M13 — Evaluation and thesis materials

**Depends on:** M07 (and others as needed) · **SPEC requirements:** D-29, D-31, D-33 · **Source:** `RESEARCH.md`

## Goal
A reproducible analysis of the real experiment data, honest supporting checks, and materials for the thesis chapters.

## Scope
- Running the analysis scripts on the **real** de-identified export: descriptive statistics, paired comparison, effect size and intervals, order/topic effects (`RESEARCH.md` §4).
- Supporting simulations (§7), **labeled synthetic**: BKT vs a simple percentage, adversarial prompts to the tutor, and optionally auditor stability.
- Tables and figures for the text; a reproduction README ("from a clean checkout to the results").
- A "designed → implemented → verified" table for every SPEC module.
- A skeleton of the thesis chapters mapped to the SPEC and `RESEARCH.md`.

## Out of scope
New platform features.

## Acceptance criteria
- [x] All scripts run from a clean repository following the instructions, with a fixed seed for synthetic data (`analysis/run_all.sh`, `analysis/README.md`)
- [x] Every output clearly labels its source: `real` or `synthetic`
- [x] The "designed/implemented/verified" table matches the state of the repository (`docs/thesis/STATUS.md`)
- [x] The conclusions in the text do not go beyond the available data (small N, limitations named; `docs/thesis/CHAPTERS.md`). **No real participant data exists yet**, so the real-data analysis is built and tested but has not been run on a real export
- [x] No number in the text exists without a corresponding script or export

## Notes for the agent
Do not invent or "tune" results. If there is no effect, that is the result.
