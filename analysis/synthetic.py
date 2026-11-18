"""Writes a SYNTHETIC modules.csv in the same format as the app's export (docs/RESEARCH.md §7, D-31).

Every number here comes from a random generator with a fixed seed and an effect size we chose ourselves. It is a test
input for analyze.py and says nothing about real learners or about the method. Never report it as a result.
"""

import argparse
import csv
import sys
from pathlib import Path

import numpy as np

SURVEY = ["survey_clarity", "survey_help", "survey_effort", "survey_frustration"]
COLUMNS = [
    "participant_code", "module", "condition", "period", "order_variant", "pretest", "posttest",
    "delayed_posttest", "gain_post", "retention_change", "active_seconds", "node_test_attempts",
    "node_test_failures", "tutor_questions", *SURVEY,
]
BANNER = "SYNTHETIC DATA: generated with a fixed seed for testing the analysis. Not a research result."


def generate(n: int, seed: int, true_effect: float = 0.15) -> list[dict]:
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        order = "A_then_B" if i % 2 == 0 else "B_then_A"
        a_method = (i // 2) % 2 == 0
        ability = rng.normal(0, 0.08)
        for module in ("A", "B"):
            method = (module == "A") == a_method
            period = 1 if (module == "A") == (order == "A_then_B") else 2
            pre = float(np.clip(0.35 + ability + rng.normal(0, 0.08), 0.05, 0.9))
            learn = 0.30 + (true_effect if method else 0.0) + ability + rng.normal(0, 0.10)
            post = float(np.clip(pre + (1 - pre) * learn, 0, 1))
            delayed = float(np.clip(post - 0.08 + (0.05 if method else 0.0) + rng.normal(0, 0.07), 0, 1))
            # the app exports shares of correct answers out of 6 questions
            pre, post, delayed = (round(x * 6) / 6 for x in (pre, post, delayed))
            gain = None if pre >= 1 else (post - pre) / (1 - pre)
            rows.append({
                "participant_code": f"SYN-{i + 1:03d}", "module": module,
                "condition": "method" if method else "control", "period": period, "order_variant": order,
                "pretest": pre, "posttest": post, "delayed_posttest": delayed,
                "gain_post": gain, "retention_change": delayed - post,
                "active_seconds": int(rng.normal(900 if method else 700, 120)),
                "node_test_attempts": int(rng.integers(2, 6)) if method else 0,
                "node_test_failures": int(rng.integers(0, 3)) if method else 0,
                "tutor_questions": int(rng.integers(0, 6)) if method else 0,
                **{c: int(np.clip(round(rng.normal(3.6 if method else 3.2, 0.9)), 1, 5)) for c in SURVEY},
            })
    return rows


TUTOR_COLUMNS = ["participant_code", "module", "condition", "hint_level", "source", "fallback_reason", "first_draft_revealed"]


def generate_tutor(rows: list[dict], seed: int) -> list[dict]:
    """One row per tutor reply of a method module. The share of flagged drafts (8 %) is our own choice, not a finding."""
    rng = np.random.default_rng(seed + 1)
    out = []
    for r in rows:
        for k in range(r["tutor_questions"]):
            flagged = bool(rng.random() < 0.08)
            fallback = flagged and bool(rng.random() < 0.7)
            out.append({
                "participant_code": r["participant_code"], "module": r["module"], "condition": r["condition"],
                "hint_level": min(k, 2) + 1, "source": "static" if fallback else "llm",
                "fallback_reason": "guard_violation" if fallback else "",
                "first_draft_revealed": "true" if flagged else "false",
            })
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=20261117)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out" / "synthetic-data" / "modules.csv")
    args = ap.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    rows = generate(args.n, args.seed)
    with args.out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if v is None else v for k, v in r.items()})
    tutor = generate_tutor(rows, args.seed)
    with args.out.with_name("tutor.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=TUTOR_COLUMNS)
        w.writeheader()
        w.writerows(tutor)
    # the banner lives next to the data, so the file cannot be mistaken for a real export
    args.out.with_name("SYNTHETIC.txt").write_text(BANNER + f"\nseed={args.seed} n={args.n}\n")
    print(BANNER, file=sys.stderr)
    print(f"wrote {len(rows)} rows to {args.out} and {len(tutor)} tutor replies to tutor.csv")


if __name__ == "__main__":
    main()
