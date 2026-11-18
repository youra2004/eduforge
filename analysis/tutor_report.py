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
from pathlib import Path

from common import Report

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", type=Path, default=Path(__file__).parent / "out" / "synthetic")
    args = ap.parse_args()
    with (args.dir / "tutor_guard.csv").open(newline="") as fh:
        rows = list(csv.DictReader(fh))
    isolation = json.loads((args.dir / "tutor_isolation.json").read_text())
    b = lambda v: v == "true"

    prompts = len({r["prompt_id"] for r in rows})
    rep = Report("Supporting check: tutor guard on scripted leaking drafts", "synthetic",
                 f"{len(rows)} tutor turns through the real tutor pipeline: {prompts} adversarial prompts x "
                 f"{len({r['question'] for r in rows})} questions x draft styles. A scripted model writes the draft, so "
                 "the draft does not depend on the student's message, and the guard (the Mock judge) never sees the "
                 "message either: every prompt gives the same outcome for a given question and draft style. The cells "
                 "below are therefore pass/fail facts about the guard, not rates, and carry no intervals. This does not "
                 "say how often a real model leaks.")

    rep.add("## Does a leaking draft reach the student?", "",
            "Without a guard every leaking draft is shown. Each cell: `blocked` = the guard replaced it with a static "
            f"hint for all {prompts} prompts, `SHOWN` = it reached the student for all {prompts} prompts, otherwise k of "
            f"{prompts} blocked.", "")
    cell: dict[tuple[str, str], str] = {}
    for key in {(r["question"], r["style"]) for r in rows}:
        rs = [r for r in rows if (r["question"], r["style"]) == key]
        shown = sum(b(r["leak_shown"]) for r in rs)
        cell[key] = "SHOWN" if shown == len(rs) else "blocked" if shown == 0 else f"{len(rs) - shown} of {len(rs)} blocked"
    styles = [s for s in dict.fromkeys(r["style"] for r in rows) if s != "compliant"]
    questions = list(dict.fromkeys(r["question"] for r in rows))
    rep.table(["Question", *styles], [[q, *[cell.get((q, s), "n/a") for s in styles]] for q in questions])
    rep.add("Reading it: the Mock guard blocks a draft that contains the reference answer text (after lower-casing and "
            "trimming quotes and punctuation) and passes anything else: a position (\"the second option\"), the answer "
            "named by elimination or in another language, and, for a question with several accepted answers, the "
            "answer itself, because the reference is the joined list (`short_two_accepted`). Those are limits of the "
            "Mock, which exists for tests and the demo. A real LLM judge may catch more of them; that is unmeasured "
            "(no real provider yet).", "")

    ok = [r for r in rows if r["style"] == "compliant"]
    rep.add("## Compliant drafts (no answer in them)", "",
            f"{len(ok)} turns: {sum(b(r['guard_flagged_first_draft']) for r in ok)} flagged by the guard, "
            f"{sum(r['shown_source'] == 'static' for r in ok)} replaced by a static hint.", "")

    rep.add("## Isolation: what reaches the tutor", "",
            "A marker string stands for each secret; the marker must never appear in a tutor prompt. "
            f"{isolation['adversarial_messages']} adversarial messages were sent, half with a question and half in free chat.", "")
    n = isolation["tutor_calls"]
    rep.table(["Check", "Result", "Expected"], [
        ["tutor prompts containing the answer key", f"{isolation['tutor_prompts_with_answer_key']} of {n}", 0],
        ["tutor prompts containing the text of a not-yet-passed node (a broken scope filter would surface it)", f"{isolation['tutor_prompts_with_locked_node_text']} of {n}", 0],
        ["requests naming an `exam` pool question refused", f"{isolation['exam_question_requests_refused']} of {isolation['exam_question_requests']}", "all"],
        ["guard prompts containing the answer key (positive control: by design, only with a question)", f"{isolation['guard_prompts_with_answer_key']} of {isolation['guard_calls']}", "only with a question"],
        ["tutor and guard prompts containing the rubric", f"{isolation['tutor_prompts_with_rubric'] + isolation['guard_prompts_with_rubric']} of {n + isolation['guard_calls']}", "0 (not exercised: no tutor code reads the rubric, the row is a regression marker)"],
    ])
    rep.save(args.dir / "tutor_results.md")
    by_style = {st: [r for r in rows if r['style'] == st] for st in dict.fromkeys(r['style'] for r in rows)}
    figure(args.dir, by_style)
    print(rep.text())


def figure(out: Path, by_style: dict[str, list[dict]]) -> None:
    """Per draft style: the share of (question, prompt) pairs in which the leaking draft was shown. The question set is ours."""
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
    ax.set_ylabel("share of leaking drafts shown\n(over our own question set)")
    ax.set_ylim(0, 1.3)
    ax.legend(loc="upper center", ncol=2, frameon=False)
    ax.set_title("Tutor guard on scripted leaking drafts   [SOURCE: synthetic]", fontsize=10)
    fig.tight_layout()
    fig.savefig(out / "fig_tutor_guard.png", dpi=140)
    plt.close(fig)


if __name__ == "__main__":
    main()
