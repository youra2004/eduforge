# Thesis skeleton

Chapters mapped to the SPEC, `RESEARCH.md` and the repository. "Source" is where every statement and number in the
chapter must come from; if there is no source, the statement does not go in. "Ready" says what can be written today.

**Rules for the text**

1. No number without a script output or an export behind it (`analysis/`, `docs/thesis/synthetic-results/`, test output).
2. Anything labeled **synthetic** is an engineering check, never a result about learners. Say so where it appears.
3. Small N means wide intervals and low power. Report effect sizes with intervals; do not write "no effect" for a
   non-significant result, and do not write "proved" for a significant one. A null result is a valid result.
4. Say "verified with the Mock provider" wherever the behavior depends on a model. No real model was ever called.
5. References are not listed here on purpose: the author collects the literature. Do not cite from this skeleton.

| # | Chapter | Source | Ready |
|---|---|---|---|
| 1 | **Introduction.** Problem, research question RQ, hypotheses H1–H4, the narrow novelty, contribution, structure | `RESEARCH.md` §1; `SPEC.md` §1 | Yes. Use the novelty paragraph as written: applied and narrow |
| 2 | **Background and related work.** Mastery learning, BKT, intelligent tutors, retrieval-augmented tutors and answer leakage, online proctoring and its limits, verifiable credentials | Literature (author) | No: needs the author's reading list |
| 3 | **Requirements and system design.** Goals and non-goals (§2), roles (§3), architecture and principles P1–P6 (§4), data model | `SPEC.md` §2–§4, §6; `DATA_MODEL.md`; ADRs 0001–0004 | Yes |
| 3.1 | Courses, graph, content, question bank (F1–F3) | `SPEC.md` F1–F3; ADRs 0005–0007 | Yes |
| 3.2 | Audit and the 1–10 rating (F4): two axes, volume cap, formula, expert review | `SPEC.md` F4; ADR 0011 | Yes. The calibration (OQ-5) is open: say so |
| 3.3 | **Learning engine** (F5): BKT per skill, gating at 0.80, rounds and pause | `SPEC.md` F5, OQ-11; ADR 0008 | Yes |
| 3.4 | **AI tutor** (F6): scope filter in SQL, hint ladder, guard, fallback, injection handling | `SPEC.md` F6; ADR 0009 | Yes |
| 3.5 | Recommendations (F7), exam (F8), proctoring (F9), certificate (F10), admin (F11) | `SPEC.md` F7–F11; ADRs 0012–0015 | Yes. Proctoring is deterrence and evidence, not a guarantee (§5 F9 intro) |
| 4 | **Implementation.** Stack, milestones M00–M13, packages, providers behind interfaces, Mocks, demo mode | `milestones/`; ADRs; `README.md` | Yes |
| 5 | **Verification of the system.** What was tested and how; the designed → implemented → verified table; what is not verified | `STATUS.md` | Yes |
| 5.1 | Supporting check: BKT against a percentage rule (synthetic) | `synthetic-results/bkt-vs-percentage.md` (`analysis/sim_bkt.py`) | Yes. Name the generator assumptions and that "matched" favours BKT |
| 5.2 | Supporting check: tutor guard on adversarial prompts (synthetic) and isolation counts | `synthetic-results/tutor-guard.md` (`pnpm simulate-tutor`, `analysis/tutor_report.py`) | Yes. It tests the Mock guard, not a model |
| 5.3 | Optional: auditor stability across repeated runs | needs a real provider | **No.** Not run; state it as future work |
| 6 | **Experiment design.** Within-subject crossover, counterbalancing, measures, instruments, consent, anonymization, threats to validity | `RESEARCH.md` §2, §3, §5, §6; ADR 0010; D-30 is still unconfirmed (🟡) and OQ-3, OQ-4 are open | Yes, but record whether D-30 and OQ-3/OQ-4 were settled before the first participant |
| 7 | **Results.** Participants and exclusions; descriptives; H1, H2 (paired comparison, effect size with interval); H3; H4; order and topic effects; power note | `analysis/analyze.py <export> --source real` → `analysis/out/real/results.md` | **No: there is no real participant data yet.** The 14 participants in the development database are e2e test accounts. `synthetic-results/pipeline-check.md` only shows that the pipeline runs; never quote it as a result |
| 8 | **Discussion and limitations.** What the data support and do not; threats (small N, recruitment, carry-over, novelty effect, single provider, Mock-only checks); the gaps in `STATUS.md` | `RESEARCH.md` §5; `STATUS.md`; the power line of `results.md` | After chapter 7 |
| 9 | **Conclusion and future work.** Real providers (OQ-1), larger study, auditor stability, calibration of the rating and of the BKT threshold, spaced repetition, admin LLM-cost view | `STATUS.md` gaps; SPEC "out of scope" | After chapter 7 |
| A | Appendices: reproduction guide, decision log, ADR list, adversarial prompt set, questionnaire items | `analysis/README.md`; `SPEC.md` §7; `docs/adr/`; `packages/core/seed/tutor-adversarial-prompts.json`; `survey.ts` | Yes |

## What the text may claim today

| Claim | Basis |
|---|---|
| The system implements F1–F10 as specified, verified with Mock providers | `STATUS.md` |
| The tutor prompt never contained the key, the rubric, the exam pool or a locked node's text in the adversarial run | `synthetic-results/tutor-guard.md`, isolation table (24 prompts) |
| The Mock guard misses non-verbatim leaks | `synthetic-results/tutor-guard.md` |
| On synthetic students, BKT predicts the next answer slightly better than a running percentage and declares mastery sooner, with more false declarations than the window rules | `synthetic-results/bkt-vs-percentage.md`; depends on the generator |
| Whether the method improves learning | **Nothing.** No real data |
