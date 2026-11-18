# Analysis

Scripts for the study analysis (`docs/RESEARCH.md` §4, §7) and the supporting checks. Python 3 (numpy, scipy,
matplotlib, pinned in `requirements.txt`). Every output states its source: **real** (the study's de-identified export)
or **synthetic** (code with a fixed seed; never a result about learners).

## From a clean checkout to the synthetic results

```bash
cp .env.example .env && pnpm install
docker compose up -d --wait        # Postgres: the tutor simulation runs on a scratch database
pnpm db:migrate
analysis/run_all.sh
```

`run_all.sh` creates `analysis/.venv`, installs the pinned packages, and runs, with fixed seeds:

| Step                                                                                              | Output (`analysis/out/synthetic/`, git-ignored)                                      | Text copy (committed)                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `synthetic.py` writes a synthetic export with a planted effect (to test the pipeline)             | `../synthetic-data/modules.csv`, `tutor.csv`, `SYNTHETIC.txt`                        |                                                   |
| `analyze.py … --source synthetic`                                                                 | `results.md`, `paired_tests.csv`, `fig_gain_post.png`, `fig_delayed_posttest.png`    | `docs/thesis/synthetic-results/pipeline-check.md` |
| `sim_bkt.py`: BKT vs a percentage rule on synthetic students                                      | `bkt_results.md`, `bkt_detection.csv`, `fig_bkt_vs_percentage.png`                   | `…/bkt-vs-percentage.md`                          |
| `pnpm simulate-tutor` + `tutor_report.py`: the real tutor pipeline with a scripted attacker model | `tutor_guard.csv`, `tutor_isolation.json`, `tutor_results.md`, `fig_tutor_guard.png` | `…/tutor-guard.md`                                |

Re-running changes nothing: `git diff docs/thesis/synthetic-results` is empty afterwards.
Tests of the analysis code: `analysis/.venv/bin/python -m unittest discover -s analysis`.

## Real data

1. Download the CSVs from the admin page, "Експорт дослідження": `modules.csv` and `tutor.csv` (and `answers`, `events`) into one directory. They hold pseudonym codes only; the scripts refuse a file with a personal column.
2. `analysis/.venv/bin/python analysis/analyze.py <dir> --source real` writes `analysis/out/real/results.md`, `paired_tests.csv` and the figures.
3. The source is mandatory. A `SYNTHETIC.txt` next to the data forces `synthetic`. Real results are never committed by the scripts.

What `analyze.py` does: recomputes the normalized gain from the pre- and post-test (it does not trust the export's column), then reports descriptives, the paired comparison for H1 (gain), H2 (delayed post-test) and H3 (active time and questionnaire), Cohen's d for paired data with a bootstrap interval, a primary test fixed in advance (Wilcoxon if the differences are clearly non-normal, else paired t), Holm correction over the three outcomes, order, topic and period effects, a topic-equivalence check, a power note (the smallest effect the sample can detect) and, from `tutor.csv`, the share of drafts the guard flagged with a Wilson interval (H4). With fewer than 20 complete pairs the report carries a warning.

## What the supporting checks do not say

- `sim_bkt.py`: the generator is a BKT-shaped process, so the "matched" scenario favours BKT; nothing is evidence about real learners.
- `simulate-tutor`: draft styles are enumerated by us and the guard is the Mock judge (a substring check). It measures what the pipeline does with those drafts, not how often a real model leaks. A real provider has not been used (SPEC OQ-1).
