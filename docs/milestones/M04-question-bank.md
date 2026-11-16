# M04 — Question bank: generator and validator

**Depends on:** M03 · **SPEC requirements:** F3 (R1–R7), D-02, D-17, P6

## Goal
Question pools produced by a separate generator and checked by a separate validator, with correct metadata for BKT.

## Scope
- Tables `questions`, `static_hints`; pools `node`, `exam`, `assessment`.
- The **generator** job: its input is only the node's theory and the skill list; its output is `mcq/short/open` questions against a Zod schema.
- The **validator** job (a separate call): correctness of the key against the theory, unambiguous wording, match to the skill, difficulty; statuses `validated`/`rejected` with a reason.
- `guess/slip/difficulty` metadata per F3-R5.
- Minimum-pool checks (F3-R6) as part of publication validation.
- Graders: `mcq` automatic; `short` — normalization + LLM equivalence; `open` — LLM against a rubric (threshold 0.7 from config).
- Author UI: the node's question list, manual add/edit (with re-validation), approve/reject.

## Out of scope
The node test and BKT (M05), the exam (M09).

## Acceptance criteria
- [ ] The generator prompt contains nothing except the node's theory and the skills (captured-prompt check on the Mock)
- [ ] The validator rejects a question with a wrong key on prepared fixtures
- [ ] The pool-disjointness constraint holds (an attempt to use an `exam` question in a node test is rejected)
- [ ] `answer_key` and `rubric` are **absent** from every student-facing DTO (contract test)
- [ ] The minimum-pool check reports exactly which questions are missing

## Tests
Unit: graders, `guess` formulas. Integration: the pipeline on the Mock, DTO contract tests.

## Notes for the agent
Question quality is critical for the research: log `generator_run_id` and `validator_run_id` on every question.
