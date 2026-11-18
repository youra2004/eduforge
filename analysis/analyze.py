"""Analysis of the EduForge study (docs/RESEARCH.md §4): H1–H4, order and topic effects.

Input: the directory with the app's de-identified export (admin panel -> "Експорт дослідження"): `modules.csv`
and, for H4, `tutor.csv`. The source must be declared with --source; a `SYNTHETIC.txt` next to the data forces
`synthetic`. Output: `results.md`, CSV tables and figures in --out (default analysis/out/<source>).

    python analysis/synthetic.py
    python analysis/analyze.py analysis/synthetic --source synthetic
"""

import argparse
import csv
import warnings
from pathlib import Path

import numpy as np
from scipy import stats

from common import SOURCES, Report, pct, wilson

SEED = 12345  # the bootstrap is reproducible
PERSONAL = {"email", "name", "display_name", "user_id", "full_name", "first_name", "last_name"}
SURVEY = ["clarity", "help", "effort", "frustration"]
UNDERPOWERED_BELOW = 20  # complete pairs; under this the report carries a warning


def normalized_gain(pre: float, post: float):
    """(post - pre) / (1 - pre); undefined when pre is already 1."""
    return None if pre >= 1 else (post - pre) / (1 - pre)


def load(path: Path, allow_empty: bool = False) -> list[dict]:
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        columns = reader.fieldnames or []
    if not rows and not allow_empty:
        raise SystemExit(f"{path} has no rows.")
    forbidden = [c for c in columns if c in PERSONAL]
    if forbidden:
        raise SystemExit(f"The input has personal columns {forbidden}; use the de-identified export.")
    return rows


def f(v):
    return float(v) if v not in ("", None) else None


def paired_by_participant(rows: list[dict], column: str):
    """One (method, control) pair per participant for `column`; participants missing either side are dropped."""
    by: dict[str, dict] = {}
    for r in rows:
        value = f(r[column])
        if value is not None:
            slot = by.setdefault(r["participant_code"], {})
            if r["condition"] in slot:
                raise SystemExit(f"Duplicate row for {r['participant_code']} / {r['condition']}: the export is malformed.")
            slot[r["condition"]] = value
    pairs = [(v["method"], v["control"]) for v in by.values() if "method" in v and "control" in v]
    return np.array(pairs, dtype=float).reshape(-1, 2)


def cohens_d_paired(diff: np.ndarray) -> float:
    # scores are k/6 shares: differences equal "up to float noise" must count as equal (std 0), not as d = 1e15
    sd = diff.std(ddof=1) if len(diff) > 1 else 0.0
    return float(diff.mean() / sd) if sd > 1e-9 else float("nan")


def bootstrap(diff: np.ndarray, stat, n_boot: int = 5000, alpha: float = 0.05):
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(diff), size=(n_boot, len(diff)))
    values = np.array([stat(diff[i]) for i in idx])
    values = values[~np.isnan(values)]
    if len(values) == 0:
        return float("nan"), float("nan")
    return float(np.quantile(values, alpha / 2)), float(np.quantile(values, 1 - alpha / 2))


def min_detectable_d(n: int, power: float = 0.8, alpha: float = 0.05) -> float:
    """Smallest paired Cohen's d a two-sided paired t-test detects with the given power (noncentral t)."""
    if n < 3:
        return float("nan")
    df, crit = n - 1, stats.t.ppf(1 - alpha / 2, n - 1)
    lo, hi = 0.0, 5.0
    for _ in range(60):  # bisection on d
        mid = (lo + hi) / 2
        nc = mid * np.sqrt(n)
        p = 1 - stats.nct.cdf(crit, df, nc) + stats.nct.cdf(-crit, df, nc)
        lo, hi = (mid, hi) if p < power else (lo, mid)
    return (lo + hi) / 2


def holm(pvalues: list[float]) -> list[float]:
    """Holm-adjusted p-values; undefined (NaN) tests are left out of the family and stay NaN."""
    defined = [i for i, p in enumerate(pvalues) if p == p]
    adjusted = [float("nan")] * len(pvalues)
    running = 0.0
    for rank, i in enumerate(sorted(defined, key=lambda i: pvalues[i])):
        running = max(running, min(1.0, (len(defined) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def differences(a, b) -> np.ndarray:
    """a - b rounded to 9 decimals: scores are k/6 shares, so differences equal "up to float noise" must be equal."""
    return np.round(np.asarray(a, dtype=float) - np.asarray(b, dtype=float), 9)


def paired_t_p(a, b) -> float:
    """Paired t-test p on the rounded differences; NaN when they have no spread (the statistic is undefined)."""
    diff = differences(a, b)
    if len(diff) < 2 or diff.std() <= 1e-9:
        return float("nan")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return float(stats.ttest_1samp(diff, 0.0).pvalue)


def wilcoxon_p(a, b) -> float:
    """Wilcoxon signed-rank p on the rounded differences, NaN when undefined (all zero, or too few distinct ones)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return float(stats.wilcoxon(differences(a, b)).pvalue)
        except ValueError:
            return float("nan")


def compare(pairs: np.ndarray) -> dict | None:
    """Paired method-vs-control statistics for one outcome, or None when there are too few complete pairs."""
    if len(pairs) < 3:
        return None
    method, control = pairs[:, 0], pairs[:, 1]
    diff = differences(method, control)
    shapiro_p = float(stats.shapiro(diff).pvalue) if diff.std() > 1e-9 else float("nan")
    t_p = paired_t_p(method, control)
    w_p = wilcoxon_p(method, control)
    lo, hi = bootstrap(diff, np.mean)
    d_lo, d_hi = bootstrap(diff, cohens_d_paired)
    # rule fixed in advance: the Wilcoxon test when the differences are clearly non-normal (Shapiro p < .05)
    use_w = shapiro_p < 0.05 and w_p == w_p  # (choosing the test from the same data slightly inflates type I error)
    return {
        "n": len(pairs), "method_mean": method.mean(), "control_mean": control.mean(),
        "method_sd": method.std(ddof=1), "control_sd": control.std(ddof=1), "diff": diff.mean(),
        "ci_lo": lo, "ci_hi": hi, "d": cohens_d_paired(diff), "d_lo": d_lo, "d_hi": d_hi,
        "t_p": t_p, "w_p": w_p, "shapiro_p": shapiro_p,
        "test": "Wilcoxon" if use_w else "paired t", "p": w_p if use_w else t_p,
    }


def fmt_p(p: float) -> str:
    return "n/a" if p != p else ("< 0.001" if p < 0.001 else f"{p:.3f}")


def outcome_table(rep: Report, results: dict[str, dict | None], out: Path) -> None:
    rows, csv_rows = [], []
    live = {k: v for k, v in results.items() if v}
    adj = dict(zip(live, holm([v["p"] for v in live.values()]))) if live else {}  # the family: the outcomes with a defined p
    for name, r in results.items():
        if r is None:
            rows.append([name, "<3", "too few complete pairs", "", "", "", "", "", ""])
            continue
        rows.append([
            name, r["n"], f"{r['method_mean']:.3f} ({r['method_sd']:.3f})", f"{r['control_mean']:.3f} ({r['control_sd']:.3f})",
            f"{r['diff']:+.3f} [{r['ci_lo']:+.3f}, {r['ci_hi']:+.3f}]",
            "n/a (no spread)" if r["d"] != r["d"] else f"{r['d']:+.2f} [{r['d_lo']:+.2f}, {r['d_hi']:+.2f}]",
            f"{r['test']}: {fmt_p(r['p'])}", fmt_p(adj[name]), f"t {fmt_p(r['t_p'])} / W {fmt_p(r['w_p'])} / Shapiro {fmt_p(r['shapiro_p'])}",
        ])
        csv_rows.append({"outcome": name, **{k: r[k] for k in r}, "p_holm": adj[name]})
    rep.table(["Outcome", "Pairs", "Method mean (SD)", "Control mean (SD)", "Mean diff [95 % bootstrap CI]",
               "Cohen's d paired [95 % CI]", "Primary test: p", f"p (Holm, {len(adj)} outcome(s) with a defined p)", "All p-values"], rows)
    if csv_rows:
        with (out / "paired_tests.csv").open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(csv_rows[0]))
            w.writeheader()
            w.writerows(csv_rows)


def group_test(a: list[float], b: list[float]) -> str:
    if len(a) < 2 or len(b) < 2:
        return "too few participants per group"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        t = stats.ttest_ind(a, b, equal_var=False).pvalue
        u = stats.mannwhitneyu(a, b).pvalue
    return f"Welch p = {fmt_p(float(t))}, Mann–Whitney p = {fmt_p(float(u))}"


def order_topic_effects(rep: Report, rows: list[dict]) -> None:
    """RESEARCH.md §4.4: does the method-minus-control gain difference depend on the sequence or on the topic?"""
    per: dict[str, dict] = {}
    for r in rows:
        g = f(r["gain_post"])
        if g is None:
            continue
        p = per.setdefault(r["participant_code"], {})
        p[r["condition"]] = g
        p["period_" + r["condition"]] = int(r["period"])
        if r["condition"] == "method":
            p["method_topic"] = r["module"]
        p[f"gain_period{r['period']}"] = g
        p["pre_" + r["module"]] = f(r["pretest"])
        p["post_" + r["module"]] = f(r["posttest"])
    full = {k: v for k, v in per.items() if "method" in v and "control" in v}
    rep.add("### Sequence effect (method first vs control first)", "",
            "The standard check of a two-period crossover: if (method − control) differs between the two sequences, "
            "carry-over or a period effect is at work. In a two-period design carry-over cannot be separated from the "
            "sequence, so this is an indication, not a correction.", "")
    by_seq: dict[str, list[float]] = {}
    for v in full.values():
        seq = "method first" if v["period_method"] == 1 else "control first"
        by_seq.setdefault(seq, []).append(float(differences(v["method"], v["control"])))
    rep.table(["Sequence", "Participants", "Mean of (method − control) gain"],
              [[k, len(v), f"{np.mean(v):+.3f}"] for k, v in sorted(by_seq.items())])
    keys = sorted(by_seq)
    rep.add(group_test(by_seq[keys[0]], by_seq[keys[1]]) if len(keys) == 2 else "Only one sequence group present.", "")

    rep.add("### Topic effect (which topic received the method)", "")
    by_topic: dict[str, list[float]] = {}
    for v in full.values():
        by_topic.setdefault(v["method_topic"], []).append(float(differences(v["method"], v["control"])))
    rep.table(["Topic with the method", "Participants", "Mean of (method − control) gain"],
              [[k, len(v), f"{np.mean(v):+.3f}"] for k, v in sorted(by_topic.items())])
    keys = sorted(by_topic)
    rep.add(group_test(by_topic[keys[0]], by_topic[keys[1]]) if len(keys) == 2 else "Only one topic group present.", "")

    rep.add("### Period effect (first vs second module, regardless of condition)", "")
    both = [(v["gain_period1"], v["gain_period2"]) for v in full.values() if "gain_period1" in v and "gain_period2" in v]
    if len(both) >= 3:
        a, b = np.array(both).T
        rep.add(f"Mean gain in period 1 = {a.mean():.3f}, period 2 = {b.mean():.3f}, "
                f"paired t p = {fmt_p(paired_t_p(a, b))} (n = {len(both)}).", "")
    else:
        rep.add("Too few participants.", "")

    rep.add("### Topic equivalence (topic A vs topic B for the same participant)", "")
    eq = [(v["post_A"], v["post_B"], v["pre_A"], v["pre_B"]) for v in full.values()
          if None not in (v.get("post_A"), v.get("post_B"), v.get("pre_A"), v.get("pre_B"))]
    if len(eq) >= 3:
        arr = np.array(eq)
        rep.add(f"Pre-test A {arr[:, 2].mean():.3f} vs B {arr[:, 3].mean():.3f} "
                f"(paired t p = {fmt_p(paired_t_p(arr[:, 2], arr[:, 3]))}); "
                f"post-test A {arr[:, 0].mean():.3f} vs B {arr[:, 1].mean():.3f} "
                f"(paired t p = {fmt_p(paired_t_p(arr[:, 0], arr[:, 1]))}), n = {len(eq)}.", "")
    else:
        rep.add("Too few participants.", "")


def tutor_section(rep: Report, path: Path, out: Path) -> None:
    rep.add("## H4. Tutor safety", "")
    if not path.exists():
        rep.add("No `tutor.csv` next to the data; H4 not analysed.", "")
        return
    rows = load(path, allow_empty=True)
    if not rows:
        rep.add("`tutor.csv` has no replies (nobody used the tutor).", "")
        return
    n = len(rows)
    flagged = sum(r["first_draft_revealed"] == "true" for r in rows)
    judged = sum(r["first_draft_revealed"] in ("true", "false") for r in rows)
    static = sum(r["source"] == "static" for r in rows)
    lo, hi = wilson(flagged, judged)
    slo, shi = wilson(static, n)
    rep.table(["Measure", "Count", "Share", "95 % Wilson CI"], [
        ["Tutor replies", n, "", ""],
        ["First draft flagged by the guard as revealing the answer", f"{flagged} of {judged} judged", pct(flagged / judged) if judged else "n/a", f"{pct(lo)} – {pct(hi)}"],
        ["Replies served from static hints (guard violation or provider error)", f"{static} of {n}", pct(static / n), f"{pct(slo)} – {pct(shi)}"],
    ])
    rep.add("The guard flag measures what the guard **caught**, not what **leaked**: a reply that revealed the answer "
            "and passed the guard is invisible here. The actual leakage share needs the sampled manual review "
            "(`RESEARCH.md` §3); this analysis does not replace it. The flagged share is a **lower bound** on the "
            "share of revealing drafts (the \"without guard\" side of H4) for two reasons: the guard misses some "
            "leaks, and turns without a question (free chat) are in the denominator although the guard has no "
            "reference answer there (the export does not say which turns had a question). The intervals treat replies "
            "as independent, but one participant writes many, so they are narrower than they should be.", "")


def figures(out: Path, source: str, rows: list[dict], results: dict) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    names = []
    blue, orange = "#0072B2", "#D55E00"  # colour-blind safe pair
    for name, column, label in (("H1 normalized gain", "gain_post", "Normalized gain"),
                                ("H2 delayed post-test", "delayed_posttest", "Delayed post-test score")):
        pairs = paired_by_participant(rows, column)
        if len(pairs) < 3:
            continue
        fig, (ax, bx) = plt.subplots(1, 2, figsize=(8, 4), gridspec_kw={"width_ratios": [1, 1]})
        for m, c in pairs:
            ax.plot([0, 1], [c, m], color="#999999", alpha=0.5, lw=1)
        ax.scatter(np.zeros(len(pairs)), pairs[:, 1], color=orange, label="control", zorder=3)
        ax.scatter(np.ones(len(pairs)), pairs[:, 0], color=blue, label="method", zorder=3)
        ax.set_xticks([0, 1], ["control", "method"])
        ax.set_ylabel(label)
        ax.set_title("Each line is one participant")
        diff = differences(pairs[:, 0], pairs[:, 1])
        r = results[name]
        rng = np.random.default_rng(SEED)
        bx.scatter(rng.normal(0, 0.03, len(diff)), diff, color=blue, alpha=0.7)
        bx.errorbar([0.25], [diff.mean()], yerr=[[max(0.0, diff.mean() - r["ci_lo"])], [max(0.0, r["ci_hi"] - diff.mean())]],
                    fmt="o", color="black", capsize=5)
        bx.axhline(0, color="#666666", lw=1, ls="--")
        bx.set_xlim(-0.3, 0.5)
        bx.set_xticks([])
        bx.set_ylabel("method − control")
        bx.set_title(f"Mean {diff.mean():+.3f}, 95 % CI [{r['ci_lo']:+.3f}, {r['ci_hi']:+.3f}]")
        fig.suptitle(f"{name} (n = {len(pairs)})   [SOURCE: {source}]", fontsize=10)
        fig.tight_layout()
        file = f"fig_{column}.png"
        fig.savefig(out / file, dpi=140)
        plt.close(fig)
        names.append(file)
    return names


def run(data_dir: Path, source: str, out: Path) -> Report:
    marker = data_dir / "SYNTHETIC.txt"
    if marker.exists() and source != "synthetic":
        raise SystemExit(f"{marker} says the data are synthetic; refusing to label them '{source}'.")
    rows = load(data_dir / "modules.csv")
    if source == "real" and any(r["participant_code"].startswith("SYN-") for r in rows):
        raise SystemExit("Participant codes start with SYN-: these are synthetic data, not a real export.")
    # recompute the gain from pre and post, independently of the export's own column
    for r in rows:
        pre, post = f(r["pretest"]), f(r["posttest"])
        g = normalized_gain(pre, post) if pre is not None and post is not None else None
        r["gain_post"] = "" if g is None else repr(g)
    out.mkdir(parents=True, exist_ok=True)
    codes = {r["participant_code"] for r in rows}
    rep = Report("EduForge study: analysis of the export", source,
                 f"Input: `{data_dir / 'modules.csv'}`. {len(rows)} participant-module rows, {len(codes)} participants.")

    perfect = sum(f(r["pretest"]) is not None and f(r["pretest"]) >= 1 for r in rows)
    h1, h2, h3 = (paired_by_participant(rows, c) for c in ("gain_post", "delayed_posttest", "active_seconds"))
    complete = min(len(h1), len(h2))
    rep.add("## Sample and power", "")
    mde = min_detectable_d(max(len(h1), 3))
    rep.add(f"- Complete method/control pairs: H1 {len(h1)}, H2 {len(h2)}, H3 {len(h3)}.",
            f"- With {len(h1)} pairs a two-sided paired t-test (α = 0.05, power 0.80) detects only an effect of "
            f"|d| ≥ {mde:.2f}; smaller effects stay invisible." if len(h1) >= 3 else "- Too few pairs to say anything.")
    if complete < UNDERPOWERED_BELOW:
        rep.add(f"- **Warning: fewer than {UNDERPOWERED_BELOW} complete pairs. Treat every p-value and interval below as "
                "exploratory; do not read a non-significant result as \"no effect\".**")
    if perfect:
        rep.add(f"- {perfect} module(s) with a perfect pre-test have no normalized gain and are left out of H1 (RESEARCH §3).")
    rep.add("")

    rep.add("## Descriptives per condition (all modules)", "")
    desc = []
    for cond in ("method", "control"):
        sub = [r for r in rows if r["condition"] == cond]
        for col in ("pretest", "posttest", "delayed_posttest", "gain_post", "active_seconds"):
            vals = np.array([f(r[col]) for r in sub if f(r[col]) is not None])
            if len(vals):
                desc.append([cond, col, len(vals), f"{vals.mean():.3f}", f"{np.median(vals):.3f}",
                             f"{vals.std(ddof=1):.3f}" if len(vals) > 1 else "n/a"])
    rep.table(["Condition", "Variable", "n", "Mean", "Median", "SD"], desc)

    rep.add("## H1–H3. Paired comparison, method vs control", "",
            "Differences are method − control. The primary test is fixed in advance: Wilcoxon signed-rank when the "
            "differences are clearly non-normal (Shapiro p < 0.05), else the paired t-test. Holm correction over the "
            "three outcomes. Confidence intervals are bootstrap percentile (5000 resamples, fixed seed).", "")
    results = {"H1 normalized gain": compare(h1), "H2 delayed post-test": compare(h2), "H3 active seconds": compare(h3)}
    outcome_table(rep, results, out)

    rep.add("### H3 (subjective). Questionnaire items, 1–5", "")
    survey_rows = []
    for item in SURVEY:
        pairs = paired_by_participant(rows, f"survey_{item}")
        if len(pairs) >= 3:
            diff = differences(pairs[:, 0], pairs[:, 1])
            w = fmt_p(wilcoxon_p(pairs[:, 0], pairs[:, 1]))
            survey_rows.append([item, len(pairs), f"{pairs[:, 0].mean():.2f}", f"{pairs[:, 1].mean():.2f}", f"{diff.mean():+.2f}", w])
        else:
            survey_rows.append([item, len(pairs), "", "", "", "too few pairs"])
    rep.table(["Item", "Pairs", "Method mean", "Control mean", "Diff", "Wilcoxon p (uncorrected)"], survey_rows)

    rep.add("## Sequence, topic and period effects", "")
    order_topic_effects(rep, rows)
    tutor_section(rep, data_dir / "tutor.csv", out)

    figs = figures(out, source, rows, results) if all(results[k] for k in ("H1 normalized gain", "H2 delayed post-test")) else []
    if figs:
        rep.add("## Figures", "", *[f"- `{n}`" for n in figs], "")
    rep.add("## What this does not show", "",
            "- Non-random recruitment and a small sample limit generalization (`RESEARCH.md` §5).",
            "- Carry-over cannot be separated from the sequence in a two-period crossover; the sequence, topic and period checks above are indications, not corrections.",
            "- Proctoring and the certificate are not part of any claim here.", "")
    rep.save(out / "results.md")
    return rep


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data_dir", type=Path, help="directory with modules.csv (and tutor.csv)")
    ap.add_argument("--source", choices=SOURCES, required=True, help="real study export or synthetic test data")
    ap.add_argument("--out", type=Path, help="default: analysis/out/<source>")
    args = ap.parse_args()
    out = args.out or Path(__file__).parent / "out" / args.source
    print(run(args.data_dir, args.source, out).text())


if __name__ == "__main__":
    main()
