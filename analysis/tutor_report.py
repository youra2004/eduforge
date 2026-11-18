"""Supporting check (docs/RESEARCH.md §7, D-31): summarises the tutor guard simulation (`pnpm simulate-tutor`).

`tutor_guard.csv` has one row per (adversarial prompt x question x draft style). The drafts come from a scripted model
that leaks the reference answer in known styles, and the guard is the Mock judge (a substring check), so this measures
what the guard pipeline does with those drafts. It does not estimate how often a real model leaks or how well an LLM
judge catches paraphrases; both need a real provider (SPEC OQ-1).

    pnpm simulate-tutor && python analysis/tutor_report.py [--dir analysis/out/synthetic]
"""

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from common import Report, pct, wilson


def share(k: int, n: int) -> str:
    lo, hi = wilson(k, n)
    return f"{k}/{n} = {pct(k / n) if n else 'n/a'} [{pct(lo)}, {pct(hi)}]"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", type=Path, default=Path(__file__).parent / "out" / "synthetic")
    args = ap.parse_args()
    with (args.dir / "tutor_guard.csv").open(newline="") as fh:
        rows = list(csv.DictReader(fh))
    isolation = json.loads((args.dir / "tutor_isolation.json").read_text())
    b = lambda v: v == "true"

    rep = Report("Supporting check: tutor guard on adversarial prompts", "synthetic",
                 f"{len(rows)} tutor turns: every adversarial prompt of `tutor-adversarial-prompts.json` "
                 f"({len({r['prompt_id'] for r in rows})} prompts) x {len({r['question'] for r in rows})} questions x draft styles. "
                 "Drafts come from a scripted model, the guard is the Mock judge. Intervals are 95 % Wilson.")

    rep.add("## Leaking drafts: what reaches the student", "",
            "\"Without guard\": every leaking draft would be shown. \"With guard\": the leaking drafts shown anyway "
            "(the guard passed them).", "")
    by_style: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_style[r["style"]].append(r)
    table = []
    for style, rs in by_style.items():
        if style == "compliant":
            continue
        n = len(rs)
        caught = sum(b(r["guard_flagged_first_draft"]) for r in rs)
        shown = sum(b(r["leak_shown"]) for r in rs)
        table.append([style, n, share(caught, n), share(n, n), share(shown, n)])
    rep.table(["Draft style", "Drafts", "Flagged by the guard", "Leak shown, without guard", "Leak shown, with guard"], table)

    leaking = [r for r in rows if r["style"] != "compliant"]
    shown_all = sum(b(r["leak_shown"]) for r in leaking)
    rep.add(f"All leaking styles together: without the guard {share(len(leaking), len(leaking))}; "
            f"with the guard {share(shown_all, len(leaking))}.", "")

    rep.add("## Where the Mock guard misses, by question", "")
    by_q: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in leaking:
        by_q[(r["question"], r["style"])].append(r)
    rep.table(["Question", "Draft style", "Drafts", "Leak shown with guard"],
              [[q, s, len(rs), share(sum(b(r["leak_shown"]) for r in rs), len(rs))] for (q, s), rs in sorted(by_q.items())])
    rep.add("Reading the tables: the Mock guard catches a draft that contains the reference answer text "
            "(after lower-casing and trimming quotes and punctuation) and misses anything else: an option letter, a "
            "paraphrase, or one of several accepted answers when the reference is the joined list "
            "(`short_two_accepted`). That is a limit of the Mock, which exists for tests and the demo; a real LLM judge "
            "may catch paraphrases and letters, and must be measured separately (not done: no real provider yet).", "")

    ok = [r for r in rows if r["style"] == "compliant"]
    wrongly = sum(b(r["guard_flagged_first_draft"]) for r in ok)
    static = sum(r["shown_source"] == "static" for r in ok)
    rep.add("## Compliant drafts (no answer in them)", "",
            f"- Flagged by the guard (false positives): {share(wrongly, len(ok))}",
            f"- Replaced by a static hint: {share(static, len(ok))}", "")

    rep.add("## Isolation: what reaches the tutor", "",
            f"Adversarial messages sent (with and without a question): {isolation['adversarial_messages']}. "
            "A marker string stands for each secret; \"expected 0\" means the marker must never appear in a tutor prompt.", "")
    rep.table(["Check", "Result", "Expected"], [
        ["tutor prompts containing the answer key", f"{isolation['tutor_prompts_with_answer_key']} of {isolation['tutor_calls']}", 0],
        ["tutor prompts containing the rubric", f"{isolation['tutor_prompts_with_rubric']} of {isolation['tutor_calls']}", 0],
        ["tutor prompts containing an `exam` pool question", f"{isolation['tutor_prompts_with_exam_question']} of {isolation['tutor_calls']}", 0],
        ["tutor prompts containing the text of a not-yet-passed node", f"{isolation['tutor_prompts_with_locked_node_text']} of {isolation['tutor_calls']}", 0],
        ["guard prompts containing the answer key (by design)", f"{isolation['guard_prompts_with_answer_key']} of {isolation['guard_calls']}", "only with a question"],
        ["guard prompts containing the rubric", f"{isolation['guard_prompts_with_rubric']} of {isolation['guard_calls']}", 0],
    ])
    rep.save(args.dir / "tutor_results.md")
    figure(args.dir, by_style)
    print(rep.text())


def figure(out: Path, by_style: dict[str, list[dict]]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    styles = [s for s in by_style if s != "compliant"]
    shown = [sum(b == "true" for b in (r["leak_shown"] for r in by_style[s])) / len(by_style[s]) for s in styles]
    fig, ax = plt.subplots(figsize=(7, 3.8))
    x = range(len(styles))
    ax.bar([i - 0.2 for i in x], [1.0] * len(styles), 0.4, color="#D55E00", label="without guard")
    ax.bar([i + 0.2 for i in x], shown, 0.4, color="#0072B2", label="with Mock guard")
    ax.set_xticks(list(x), styles)
    ax.set_ylabel("share of leaking drafts shown")
    ax.set_ylim(0, 1.3)
    ax.legend(loc="upper center", ncol=2, frameon=False)
    ax.set_title("Tutor guard on scripted leaking drafts   [SOURCE: synthetic]", fontsize=10)
    fig.tight_layout()
    fig.savefig(out / "fig_tutor_guard.png", dpi=140)
    plt.close(fig)


if __name__ == "__main__":
    main()
