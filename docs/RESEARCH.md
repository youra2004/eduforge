# EduForge — research design

Status: draft 0.2 · 2026-11-13 · related: D-29, D-30, D-31, D-33 in `SPEC.md`.

## 1. Research question

> **RQ.** Does BKT-based mastery gating combined with a context-limited AI tutor (RAG) improve students' learning outcomes — knowledge right after learning and retention after some time — compared with linear progression through the same material without gating and without the tutor?

### Hypotheses

- **H1.** The normalized gain in knowledge (post-test relative to pre-test) is higher in the "method" condition than in the "control" condition.
- **H2.** The result of the delayed post-test (retention) is higher in the "method" condition.
- **H3 (cost of the method).** Time spent learning and the subjective workload differ between the "method" condition and control; no direction is assumed.
- **H4 (tutor safety).** The share of attempts in which the tutor reveals the answer is low, and lower with the guard than without it (a supporting metric of implementation quality).

### Novelty (honestly)

The individual components are known (mastery learning, BKT, AI tutors). What is new is the specific construction (gating by BKT per skill + a tutor strictly limited to the context of already-passed material, with a hint ladder and a guard) and its empirical test. The novelty is **applied and narrow**; its strength depends on the quality of the experiment. The result is not guaranteed, and a null result is also valid if described honestly.

## 2. Design (draft, D-30 — awaiting confirmation)

**Within-subject (crossover):**

- Two learning modules of equal difficulty and size (topic A and topic B) that can be compared (for example, two topics from the same domain).
- Each participant completes both: one under the **method** condition (graph, mastery gating via BKT, AI tutor), the other under the **control** condition (the same content and the same self-check questions, free navigation, no gating, no tutor).
- The order and the assignment of topics to conditions are **alternated** between participants (counterbalancing): half get `A=method, B=control`, the other half the reverse; the variant is stored in `experiment_participants.order_variant`.
- Measurement for each module: **pre-test → learning → immediate post-test → delayed post-test**.
- Test questions come from a separate `assessment` pool that does not overlap with exercises and node tests (no "teaching to the test").
- A short questionnaire after each module (perceived help, workload).

Why within-subject: with a small number of participants, each person provides a paired "method vs control" comparison, which substantially strengthens the statistics compared with splitting into two small groups. Risks: a carry-over effect between modules (counterbalancing and different topics reduce it but do not remove it) and a heightened requirement that the topics be equivalent.

## 3. Measurements

| Variable | How it is measured | Tables |
|---|---|---|
| Pre-test, post-test, delayed test | share of correct answers (0–1) on `assessment`-pool questions | `assessments(kind=pretest/posttest/delayed_posttest)`, `assessment_items` |
| Normalized gain | `(post − pre) / (1 − pre)` (with `pre ≥ 1` handled separately) | computed in the analysis |
| Retention | `delayed − post` and `delayed` | same |
| Learning time | sum of active intervals per module | `event_log` |
| Node progress | number of attempts, failures, pauses | `node_progress`, `assessments` |
| Tutor usage | number of messages, hint levels | `tutor_messages` |
| Tutor answer leakage | guard verdict + sampled manual review | `tutor_messages.guard_verdict` |
| Subjective ratings | Likert scale | `event_log` (`survey_submitted`) |

### Required `event_log` events (P5)

`module_started`, `module_finished`, `content_opened`, `video_progress`, `node_test_started/submitted`, `question_answered`, `hint_requested`, `tutor_message`, `mastery_updated`, `cooldown_started`, `pretest_*`, `posttest_*`, `survey_submitted`, `session_heartbeat`. Each event carries `user_id`, `module`, `condition`, `ts`.

## 4. Analysis plan

1. Descriptive statistics per condition (means, medians, spread).
2. Paired comparison of `method` vs `control` for H1/H2: paired t-test or Wilcoxon signed-rank test (depending on the distribution; check normality of the differences).
3. Effect size (Cohen's d for paired data) and a confidence interval (bootstrap).
4. Check for order and topic effects (a fixed-effects model or, more simply, a comparison across order variants).
5. H3 — analogously; H4 — the leakage share with a confidence interval.
6. All analysis scripts live in the repository; data are a de-identified export; results are reproducible.

## 5. Threats to validity and limitations

- A small sample → low power; only a large effect would be detected. Report the effect size and intervals, not just p-values.
- Non-random recruitment (acquaintances, colleagues) → limited generalizability.
- Carry-over effect and non-equivalence of topics.
- Novelty of the interface (a novelty effect) can affect motivation.
- Quality of the generated questions: all test questions go through the validator and a sampled manual check.
- A single LLM provider → tutor results depend on the model; model and prompt versions are fixed in `llm_runs`.
- Proctoring and the certificate are **not part of the scientific claims**; they are described as part of the system.

## 6. Ethics and data

- Informed consent (`consents`, kind=`research`) before participation; the right to withdraw without consequences.
- Anonymization: only `code` appears in the export; email and names are not exported.
- Minimum necessary collection; webcam frames are **not used** in the research (proctoring is switched off in the experiment).
- Agree with the supervisor/department on the requirements for experiments involving people (OQ-4).

## 7. Supporting checks (honest simulation, D-31)

Simulation does not answer the RQ, but it can support the engineering part. All results must be the output of code with a fixed seed and clearly labeled **synthetic**:

- **BKT check:** synthetic students with a known true level; compare BKT against a simple percentage of correct answers by accuracy of predicting the next answer (AUC) and by speed of detecting mastery.
- **Tutor:** a set of adversarial prompts ("just give me the answer") to estimate the leakage share with and without the guard.
- **Auditor (optional):** stability of the score across repeated runs for several real course programs.

## 8. What must be ready for the experiment (minimal core)

Only M00–M07: graph and content from a seed file, a question pool, BKT gating, the tutor, experiment instrumentation. The auditor, proctoring, certificate and recommendations are not needed for the experiment.
