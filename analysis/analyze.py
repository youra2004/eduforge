"""Analysis skeleton for the EduForge study (docs/RESEARCH.md §4).

Input: the app's `modules.csv` export (admin panel -> "Експорт дослідження"). Output: descriptive statistics and the
paired method-vs-control tests for H1 (normalized gain) and H2 (delayed post-test), with Cohen's d and a bootstrap
confidence interval, plus an order-effect check. If a SYNTHETIC.txt sits next to the input, every table is labelled.

    python analysis/synthetic.py && python analysis/analyze.py analysis/synthetic/modules.csv
"""

import argparse
import csv
from pathlib import Path

import numpy as np
from scipy import stats

SEED = 12345  # the bootstrap is reproducible


def normalized_gain(pre: float, post: float):
    """(post - pre) / (1 - pre); undefined when pre is already 1."""
    return None if pre >= 1 else (post - pre) / (1 - pre)


def load(path: Path) -> list[dict]:
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    forbidden = [c for c in rows[0] if c in {"email", "name", "display_name", "user_id"}]
    if forbidden:
        raise SystemExit(f"The input has personal columns {forbidden}; use the de-identified export.")
    return rows


def f(v: str):
    return float(v) if v not in ("", None) else None


def paired_by_participant(rows: list[dict], column: str, derive=None):
    """One (method, control) pair per participant for `column`; participants missing either side are dropped."""
    by = {}
    for r in rows:
        value = derive(r) if derive else f(r[column])
        if value is not None:
            by.setdefault(r["participant_code"], {})[r["condition"]] = value
    pairs = [(v["method"], v["control"]) for v in by.values() if "method" in v and "control" in v]
    return np.array(pairs, dtype=float)


def cohens_d_paired(diff: np.ndarray) -> float:
    return float(diff.mean() / diff.std(ddof=1)) if len(diff) > 1 and diff.std(ddof=1) > 0 else float("nan")


def bootstrap_ci(diff: np.ndarray, n_boot: int = 5000, alpha: float = 0.05):
    rng = np.random.default_rng(SEED)
    means = rng.choice(diff, size=(n_boot, len(diff)), replace=True).mean(axis=1)
    return float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


def compare(label: str, pairs: np.ndarray) -> None:
    if len(pairs) < 3:
        print(f"{label}: only {len(pairs)} complete pairs, too few to test")
        return
    method, control = pairs[:, 0], pairs[:, 1]
    diff = method - control
    shapiro_p = stats.shapiro(diff).pvalue if len(diff) >= 3 else float("nan")
    t = stats.ttest_rel(method, control)
    try:
        w = stats.wilcoxon(method, control)
        w_p = float(w.pvalue)
    except ValueError:  # all differences are zero
        w_p = float("nan")
    lo, hi = bootstrap_ci(diff)
    print(f"{label}  (n = {len(pairs)} pairs)")
    print(f"  method  mean {method.mean():.3f}  median {np.median(method):.3f}  sd {method.std(ddof=1):.3f}")
    print(f"  control mean {control.mean():.3f}  median {np.median(control):.3f}  sd {control.std(ddof=1):.3f}")
    print(f"  mean difference {diff.mean():+.3f}   95% bootstrap CI [{lo:+.3f}, {hi:+.3f}]")
    print(f"  Cohen's d (paired) {cohens_d_paired(diff):+.2f}")
    print(f"  paired t-test p = {t.pvalue:.4f}   Wilcoxon p = {w_p:.4f}   (normality of differences, Shapiro p = {shapiro_p:.3f})")
    print("  use the Wilcoxon result when the differences are clearly non-normal")


def order_check(rows: list[dict]) -> None:
    """Does the method-vs-control difference depend on the order (A first or B first)? Compared between order groups."""
    diffs = {}
    for r in rows:
        g = f(r["gain_post"]) if r["gain_post"] != "" else None
        if g is None:
            continue
        diffs.setdefault((r["participant_code"], r["order_variant"]), {})[r["condition"]] = g
    groups = {}
    for (_, order), v in diffs.items():
        if "method" in v and "control" in v:
            groups.setdefault(order, []).append(v["method"] - v["control"])
    if len(groups) == 2 and all(len(g) > 1 for g in groups.values()):
        a, b = groups.values()
        p = stats.ttest_ind(a, b, equal_var=False).pvalue
        print("Order effect on the gain difference:", {k: round(float(np.mean(v)), 3) for k, v in groups.items()}, f"Welch p = {p:.4f}")
    else:
        print("Order effect: not enough participants per order group")


def descriptives(rows: list[dict]) -> None:
    print("Descriptives per condition (all modules)")
    for cond in ("method", "control"):
        sub = [r for r in rows if r["condition"] == cond]
        for col in ("pretest", "posttest", "delayed_posttest", "active_seconds"):
            vals = np.array([f(r[col]) for r in sub if f(r[col]) is not None])
            if len(vals):
                print(f"  {cond:8} {col:17} mean {vals.mean():.3f}  median {np.median(vals):.3f}  sd {vals.std(ddof=1):.3f}  n {len(vals)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("modules_csv", type=Path)
    args = ap.parse_args()
    marker = args.modules_csv.with_name("SYNTHETIC.txt")
    if marker.exists():
        print("=" * 78)
        print(marker.read_text().splitlines()[0])
        print("=" * 78)
    rows = load(args.modules_csv)
    # recompute the gain from pre and post, independently of the export's own column
    for r in rows:
        pre, post = f(r["pretest"]), f(r["posttest"])
        g = normalized_gain(pre, post) if pre is not None and post is not None else None
        r["gain_post"] = "" if g is None else repr(g)
    print(f"{len(rows)} participant-module rows, {len({r['participant_code'] for r in rows})} participants\n")
    descriptives(rows)
    print()
    compare("H1  normalized gain (post-test)", paired_by_participant(rows, "gain_post"))
    print()
    compare("H2  delayed post-test score", paired_by_participant(rows, "delayed_posttest"))
    print()
    compare("H3  active learning time, seconds", paired_by_participant(rows, "active_seconds"))
    print()
    order_check(rows)
    if marker.exists():
        print("\n" + marker.read_text().splitlines()[0])


if __name__ == "__main__":
    main()
