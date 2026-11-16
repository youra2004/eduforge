# M06 — AI tutor with RAG

**Depends on:** M03, M05 · **SPEC requirements:** F6 (R1–R8), D-15, P3, P6, NFR-4, NFR-7

## Goal
A tutor that helps with leading hints within already-unlocked material and never reveals answers.

## Scope
- Tables `tutor_sessions`, `tutor_messages`.
- Context: `allowedNodeIds` = the current node + passed prerequisites; search through `retrieve` (M03).
- The tutor sees the question text and the student's answer; it does **not** see `answer_key`, `rubric` or the `exam` pool.
- Hint ladder: 1 — a leading question, 2 — a pointer to a concept, 3 — an analogous example.
- **Guard**: a separate judge call "was the solution revealed"; a violation → regeneration at a lower level or a static hint.
- Fallback: an API/guard failure → the author's `static_hints`.
- Protection against prompt injection: author content as untrusted data (delimiters, no tools).
- Rate limit and a daily budget per user.
- UI: a chat panel in the node and in remediation after a failure; switched off in the exam and in the experiment's control condition.
- Logging: hint level, guard verdict, chunk ids, `llm_run_id`.

## Out of scope
Voice, multimodality, long-term tutor memory.

## Acceptance criteria
- [ ] The tutor's context contains no `answer_key`/`rubric`/`exam` pool (test with prompt capture)
- [ ] A chunk from a not-yet-passed node does **not** get into the context
- [ ] The guard blocks a prepared leak fixture and triggers regeneration/fallback
- [ ] A provider failure yields a static hint, not an error
- [ ] Prompt-injection fixtures in content do not change behavior (replies remain hints)
- [ ] The rate limit and budget work

## Tests
Unit: level selection, guard logic. Integration: scope tests, prompt capture, fallback. A set of adversarial prompts ("just give me the answer") for the H4 metric is stored as fixtures for M13.
