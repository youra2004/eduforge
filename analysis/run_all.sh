#!/usr/bin/env bash
# From a clean checkout to every SYNTHETIC supporting result (docs/RESEARCH.md §7). Needs Python 3, Node + pnpm,
# and Postgres up (`docker compose up -d --wait`, `.env` copied) for the tutor simulation.
# Real data is analysed separately: see analysis/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d analysis/.venv ] || python3 -m venv analysis/.venv
analysis/.venv/bin/pip install -q -r analysis/requirements.txt
PY=analysis/.venv/bin/python

$PY analysis/synthetic.py                                              # fixed seed -> analysis/out/synthetic-data
$PY analysis/analyze.py analysis/out/synthetic-data --source synthetic > /dev/null
$PY analysis/sim_bkt.py > /dev/null
pnpm --silent simulate-tutor > /dev/null
$PY analysis/tutor_report.py > /dev/null

# the text results are committed so the thesis can cite them; figures stay in analysis/out/synthetic
mkdir -p docs/thesis/synthetic-results
cp analysis/out/synthetic/results.md docs/thesis/synthetic-results/pipeline-check.md
cp analysis/out/synthetic/bkt_results.md docs/thesis/synthetic-results/bkt-vs-percentage.md
cp analysis/out/synthetic/tutor_results.md docs/thesis/synthetic-results/tutor-guard.md
echo "done: analysis/out/synthetic/ (tables, figures) and docs/thesis/synthetic-results/ (text)"
