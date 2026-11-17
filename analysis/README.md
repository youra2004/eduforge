# Analysis

Scripts for the study analysis (`docs/RESEARCH.md` §4). Python 3 with `numpy` and `scipy` (`pip install -r analysis/requirements.txt`).

- `synthetic.py` writes a **synthetic** `modules.csv` (fixed seed, chosen effect size) plus a `SYNTHETIC.txt` label next to it. It only tests the pipeline (D-31).
- `analyze.py <modules.csv>` loads an export and prints descriptives, paired t-test and Wilcoxon for H1 (normalized gain), H2 (delayed post-test) and H3 (active time), Cohen's d for paired data, a bootstrap 95 % CI and an order-effect check. It recomputes the gain from the pre- and post-test scores instead of trusting the export's column. It refuses an input with personal columns.

```
python analysis/synthetic.py
python analysis/analyze.py analysis/synthetic/modules.csv
```

Real data: download `modules.csv` (and `answers`, `events`, `tutor`) from the admin page, "Експорт дослідження". They hold pseudonym codes only. `analysis/synthetic/` is git-ignored output.
