# Designed → implemented → verified

State of the repository at the end of M13. "Designed" is the SPEC requirement, "implemented" is where the code lives,
"verified" names the tests that exercise it. Nothing here is verified by anything not listed.

**Verification levels.** `unit` = Vitest without a database. `integration` = Vitest against a real Postgres (the
throwaway `eduforge_test` database). `e2e` = Playwright in Chromium against the running app. `Mock` = the behaviour
was checked only with the Mock provider (LLM, embeddings, transcription, proctoring frames); no real model has ever
been called (SPEC OQ-1 is still open), so anything that depends on model quality is **not** verified.

**How to refresh the counts.** `pnpm test` prints the number of unit and integration tests; the e2e count is the number
of `test(` blocks in `e2e/*.spec.ts`. The numbers in the last section were measured when this file was written.

## Modules

| SPEC | Designed | Implemented (milestone, where) | Verified | Gaps and limits |
|---|---|---|---|---|
| F1 Courses, graph | F1-R1…R6 | M02, M08 · `packages/core/src/courses/` | unit `graph.test.ts` (cycle, isolated node, unreachable node, no skill), `import.test.ts`; integration `service.integration.test.ts` (published version is immutable, new version copies the graph), `editor.integration.test.ts`; e2e `courses.spec.ts` | Visual editor (React Flow) is covered by one integration file and e2e, not by per-interaction tests |
| F2 Content | F2-R1…R4 | M03 · `packages/core/src/content/`, worker `contentJobs.ts` | unit `chunking.test.ts`; integration `content.integration.test.ts` (transcript blocks publication, re-indexing is idempotent), worker `contentJobs.integration.test.ts`; e2e `content.spec.ts` | Transcription and embeddings: **Mock** only (no Whisper, no real embedding model). The SPEC's ~10 demo videos are not in the repository; the only video is the e2e fixture `sample.mp4` |
| F3 Question bank | F3-R1…R7 | M04 · `packages/core/src/questions/` | unit `questions.test.ts`; integration `questions.integration.test.ts` (generator sees only theory and skills, validator rejects a wrong key, pools do not overlap); worker `questionJobs.integration.test.ts`; e2e `questions.spec.ts` | Generator and validator: **Mock**; question quality from a real model is unknown |
| F4 Audit and publication | F4-R1…R8 | M08 · `packages/core/src/audit/` | unit `audit.test.ts` (volume cap, rating formula, bands); integration `audit.integration.test.ts` (state machine, rating 10 goes to an expert, run limit, thresholds hidden from the author); worker `auditJobs.integration.test.ts`; e2e `audit.spec.ts` | The auditor is **Mock**; calibration of caps and formula (OQ-5) not done. The optional auditor-stability check (RESEARCH §7) was **not** run: it needs a real model |
| F5 Learning engine | F5-R1…R7 | M05 · `packages/core/src/learning/` | unit `learning.test.ts` (BKT on the SPEC's known numbers, node pass rule, rounds and cooldown with a fixed clock); integration `learning.integration.test.ts` (locked node unreachable through the API, practice does not change mastery, every answer and every `p_known` change is logged); e2e `learning.spec.ts`; synthetic comparison with a percentage rule: `synthetic-results/bkt-vs-percentage.md` | OQ-11 (threshold strictness) is documented and measured on synthetic data only; not calibrated on real answers |
| F6 AI tutor | F6-R1…R8 | M06 · `packages/core/src/tutor/` | unit `level.test.ts`; integration `tutor.integration.test.ts` (scope filter in SQL, no answer key, rubric or exam question in the prompt, hint ladder, guard, static fallback, rate limit and budget, injection delimiters, 12 adversarial prompts); e2e `tutor.spec.ts`; simulation `synthetic-results/tutor-guard.md` | Tutor and guard are **Mock**. The Mock guard is a substring check and misses paraphrases, option letters and one of several accepted answers (measured in `tutor-guard.md`); a real judge is unmeasured |
| F7 Recommendations | F7-R1…R3 | M12 · `packages/core/src/recommendations/`, worker `recommendationJobs.ts` | unit `recommendations.test.ts`; integration `recommendations.integration.test.ts` (≤ 3 tips, unchanged metrics → no new tip and no LLM call, per-user lock); worker `recommendationJobs.integration.test.ts`; e2e `demo.spec.ts` | Phrasing is **Mock**. No e-mail or push (out of scope) |
| F8 Final exam | F8-R1…R7 | M09 · `packages/core/src/exam/` | unit `rules.test.ts` (parameters by rating, pass mark, per-skill levels, timers); integration `exam.integration.test.ts` (server clock, no peeking after an interruption, attempts and 7-day pause); e2e `exam.spec.ts` | `open` answers graded by the **Mock** LLM; no exam on mobile by design (D-22) |
| F9 Proctoring and strikes | F9-R1…R8 | M10 · `packages/core/src/proctor/`, `apps/web/src/lib/proctor.ts`, `ExamProctor.tsx` | unit `rules.test.ts` (strike ladder, hard vs soft events, keystroke intervals), `apps/web/src/lib/proctor.test.ts`; integration `proctor.integration.test.ts` (consent, strikes decided by the server, evidence encrypted with expiry, appeal); worker `proctorJobs.integration.test.ts`; e2e `proctoring.spec.ts` (Chromium fake camera, MediaPipe in the browser) | Server-side frame check and face comparison are a **Mock** `ProctorProvider`; real accuracy, bias and spoofing resistance are unmeasured. The SPEC itself says this is deterrence, not a guarantee |
| F10 Certificate | F10-R1…R5 | M11 · `packages/core/src/certificate/`, `/verify`, `/.well-known/jwks.json`, `scripts/verify-certificate.mjs` | unit `certificate.test.ts` (canonical JSON, signature, tamper detection); integration `certificate.integration.test.ts` (issue, verify, revoke, hold across a resumed exam chain); e2e `certificate.spec.ts`; independent check with Node's `crypto` only (`verify-certificate.mjs`) | Certificate text description is **Mock** LLM. PDF is the browser's "print to PDF". Account deletion is not built, so OQ-12 (holder name) stays open |
| F11 Admin panel | F11 | M01, M08, M10–M12 · `apps/web/src/app/admin/` | covered through the e2e specs of the features it hosts (users and roles `auth.spec.ts`, review queue `audit.spec.ts`, strikes `proctoring.spec.ts`, certificates `certificate.spec.ts`, demo `demo.spec.ts`) | **Not built:** a page to view `llm_runs` and cost (the table is written and queryable in SQL) and a configuration editor (settings are env vars; `/admin/demo` only displays the scaled pauses) |
| Experiment (D-29…D-31, RESEARCH §2–§4) | RESEARCH.md | M07, M13 · `packages/core/src/experiment/`, `analysis/` | unit `experiment.test.ts` (counterbalancing, gain, PII column check, heartbeat time); integration `experiment.integration.test.ts` (control has no tutor and no gating on the server, same assessment questions in both conditions, event list of RESEARCH §3 is written, export has no PII); e2e `experiment.spec.ts`; analysis `analysis/test_analysis.py` | **No real participant has taken part.** The 14 participants in the development database are end-to-end test accounts. Withdrawal from the study is not built. Real results: none |

## Principles and cross-cutting requirements

| ID | State | Evidence |
|---|---|---|
| P1 Server is the authority | Implemented | Server clocks and strikes: `exam.integration.test.ts`, `proctor.integration.test.ts`; cooldown with a faked clock: `learning.test.ts` |
| P2 Everything is configurable | Implemented | `packages/core/src/config.ts` and `config.test.ts`; every setting is an env var listed in `.env.example` |
| P3 Structured LLM outputs | Implemented | `packages/llm` `client.test.ts`, `client.integration.test.ts` (Zod validation, `llm_runs` row per call) |
| P4 Replaceable providers | Interfaces and Mocks only | LLM, embedding, transcription and proctor interfaces each have a Mock; **no real provider exists** |
| P5 Research logging | Implemented | `experiment.integration.test.ts` "research events (P5)" checks every event of RESEARCH §3 |
| P6 No answers to the tutor | Implemented | `tutor.integration.test.ts`; `synthetic-results/tutor-guard.md` counts 0 of 24 tutor prompts containing the key, rubric, exam question or a locked node's text |
| NFR-1 Language | Implemented | UI and content in Ukrainian, docs and code in English |
| NFR-2 Privacy | Partly | Export has only pseudonyms (column check, `experiment.test.ts`); frames are not stored (`proctor.integration.test.ts`); account deletion not built |
| NFR-3 Observability | Implemented | `llm_runs` written for every call; **no UI** to browse it |
| NFR-4 Security | Implemented | Password hashing and login rate limit `auth/service.integration.test.ts`; role guard `guard.test.ts`; tutor rate limit and injection delimiters `tutor.integration.test.ts`. No penetration test was done |
| NFR-5 Testability | Implemented | Mocks everywhere; CI runs lint, typecheck, unit and integration tests and the build. e2e is run locally, not in CI |
| NFR-6 Demo mode | Implemented | `TIME_SCALE` (`time.test.ts`), `pnpm seed-demo` and "run now" (`demo.spec.ts`) |
| NFR-7 Cost | Partly | Tutor token budget per user per day; no budget for generation, audit or recommendations |
| NFR-8 Accessibility | Basic only | Labels and keyboard use; no audit and no claim of WCAG conformance |

## Decisions still open or unconfirmed

OQ-1 (real providers), OQ-3 (experiment design and topics), OQ-4 (department requirements), OQ-5, OQ-6, OQ-7 (deployment),
OQ-9…OQ-12 as listed in `SPEC.md` §8; D-09b, D-18b and D-30 are 🟡 (proposed, awaiting confirmation).
The thesis must say which of these were settled before the experiment ran.

## Measured when this was written

See the "Counts" block at the end of the pull request description of M13 for the exact output of `pnpm test`,
`pnpm lint`, `pnpm typecheck` and `python -m unittest`.
