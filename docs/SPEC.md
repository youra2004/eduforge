# EduForge — SPEC (source of truth)

| | |
|---|---|
| Version | 0.2 (draft after alignment with the author; translated to English) |
| Date | 2026-11-13 |
| Document language | English (D-34). Product UI and course content: Ukrainian (D-05) |
| Related files | `DATA_MODEL.md`, `RESEARCH.md`, `milestones/`, `../CLAUDE.md` |

## 0. How to use this document

1. This file is the **single source of truth** for what the system builds. If code or a milestone contradicts the SPEC, the SPEC wins; the contradiction must be raised in "Open questions" (section 8), not resolved silently.
2. Every decision has an ID `D-xx` (section 7) and a status:
   - ✅ — explicitly confirmed by the author;
   - 🟦 — the author delegated the choice; chosen and accepted;
   - 🟡 — proposed, awaiting confirmation (treat as a working assumption until confirmed).
3. Requirements are numbered `F<module>-R<n>` and are the basis for the acceptance criteria in the milestones.
4. Changes to the SPEC: bump the version in the header, add an entry to the decision log, no silent edits.

## 1. Goal and context

EduForge is an IT-course learning platform that **guarantees competencies**: every course is standardized and receives a difficulty rating of 1–10; the student walks a knowledge graph where topics unlock only after demonstrated understanding; a final exam under controlled-integrity conditions ends in a digitally signed certificate that can be verified publicly.

The system is simultaneously:
- a **product** (fully described below), and
- the **experimental instrument** of a master's thesis. Research question: does BKT-based mastery gating combined with a context-limited AI tutor improve student learning outcomes (see `RESEARCH.md`, D-29).

Rating scale (D-07): 1–3 — junior level (basic understanding of a technology); 4–6 — middle (confident hands-on practice); 7–9 — senior (complex programs, high level of detail); 10 — expert level (full mastery at the level of the technology's creator).

## 2. Scope

**In scope:** IT courses in Ukrainian; knowledge graphs; video and text; question generation and validation; AI difficulty audit; mastery engine; AI tutor; recommendations; final exam with proctoring; certificate; admin panel; research logging.

**Out of scope (non-goals), D-05, D-28:**
- payments and monetization;
- executing student code (sandbox); practical tasks exist only as multiple-choice, short-answer and open-answer questions;
- blockchain anchoring of certificates;
- taking the exam on mobile;
- storing biometrics and "just in case" snapshots (see F9);
- a real expert marketplace (experts are simulated, D-10);
- skill decay over time and spaced repetition.

## 3. Roles

| Role | Can | Notes |
|---|---|---|
| `student` | take courses, node tests, the tutor, the exam; receive a certificate | |
| `author` | create courses/versions, edit the graph, manage content, run the audit, publish | an author can also be a student (one person, several roles) |
| `expert` | review courses in the queue, approve/reject candidates for rating 10 | assigned only by an admin (D-03); simulated in the demo (D-10) |
| `admin` | assign experts, confirm soft violations, handle appeals, revoke certificates, manage users and config | |
| employer / verifier | opens the public verification page | **no account** (D-03) |

One person can hold several roles through the `user_roles` table.

## 4. Architecture and stack

- **Frontend:** Next.js (App Router), React, TypeScript, TanStack Query; graph editor — React Flow; video — Plyr or react-player.
- **API:** Next.js route handlers for short requests; a **separate Node worker** for long jobs (audit, question generation, frame processing, recommendations, embeddings).
- **Database:** PostgreSQL + `pgvector` (HNSW index); recursive CTEs for the graph.
- **Job queue:** `pg-boss` (Postgres-backed queue, no Redis).
- **Files:** S3-compatible storage (Supabase Storage / S3) for video and short-lived violation evidence.
- **LLM:** an `LLMProvider` abstraction layer (structured outputs, Zod validation, caching, logging into `llm_runs`) plus a `MockLLMProvider` for tests and demo. Concrete providers — OQ-1.
- **Proctoring:** a `ProctorProvider` interface with `Real` and `Mock` implementations (D-23). In the browser — MediaPipe (face/pose detection); on the server — face comparison and a Vision check of the frame.
- **Transcription:** Whisper (or an equivalent) for videos without an author-provided transcript.
- **Authentication:** email + password (argon2), server-side sessions in a cookie.
- **Tests:** Vitest (unit), Playwright (e2e of key flows), contract tests for the LLM layer on the Mock.

### Principles (mandatory)

- **P1. The server is the authority.** Timers, deadlines, results, strikes and grades live only on the server. The client cannot be trusted.
- **P2. Everything is configurable.** Pauses, limits, thresholds and intervals live in config; `TIME_SCALE` exists for demos (D-32).
- **P3. Structured LLM outputs.** Every LLM call returns a schema validated by Zod; the raw output, prompt version and parameters are stored in `llm_runs`.
- **P4. Replaceable providers.** LLM, embeddings, Vision and face comparison sit behind interfaces with Mock implementations.
- **P5. Research logging from day one.** Events needed for `RESEARCH.md` are written from the start (`event_log`).
- **P6. No answers or keys ever reach the tutor.**

## 5. Functional specification

### F1. Courses and the knowledge graph

- **F1-R1.** A course has versions (`course_versions`). A published version is immutable; editing creates a new version that goes through the audit again; students already learning stay on their version; the certificate is bound to a version (D-06).
- **F1-R2.** The knowledge graph is a directed acyclic graph: nodes (`nodes`) and prerequisite edges (`node_edges`). Semantics are **AND**: a node becomes available when *all* its prerequisites are passed (D-12).
- **F1-R3.** Deterministic graph validation before the audit: no cycles (Kahn's algorithm); at least one root node; all nodes reachable from the roots; no isolated nodes (when there is more than one node); every node has ≥1 skill, ≥1 content item and enough questions in its pool (F3-R6).
- **F1-R4.** A node contains: a title, a short description, content items (F2), skills, a question pool and the author's static hints for the tutor fallback.
- **F1-R5.** Skills (`skills`) live at the course-version level. The author lists them and the AI checks that the content actually covers them (F4-R3, D-13). A skill can belong to several nodes.
- **F1-R6.** Course import from JSON by schema (milestone M02) until the visual editor exists (M08).

### F2. Content

- **F2-R1.** Types: `markdown` (with code blocks and images) and `video` (D-04).
- **F2-R2.** Video is for the demo, on the order of 10 files; stored as mp4 in storage or as an external link; an off-the-shelf player (Plyr/react-player).
- **F2-R3.** **Every video has a text transcript**: from the author or automatic (Whisper). A video lesson without a transcript cannot be published. The auditor, RAG and question generation all work from the transcript and the markdown.
- **F2-R4.** After content is saved, the worker splits the text into chunks (roughly 300–500 tokens with overlap) and creates embeddings in `content_chunks` with a `node_id` (D-15).

### F3. Question bank

- **F3-R1.** Question types: `mcq` (one correct option), `short` (short answer: normalized comparison + LLM equivalence check) and `open` (open answer graded by an LLM against a rubric; `correct` if the score is ≥ 0.7). Code is not executed (D-02, D-28).
- **F3-R2.** Questions belong to one **pool**: `node` (node tests), `exam` (final exam) or `assessment` (experiment pre-test/post-test). Pools do not overlap, so nothing leaks between them (D-17).
- **F3-R3.** Pipeline: a **generator** (a separate prompt that sees only the node's theory and the skill list) → a **validator** (a separate call: correctness of the key against the theory, unambiguous wording, match to the skill, difficulty estimate) → status `validated` or `rejected` with a reason (D-17). Questions are generated ahead of time while preparing for publication, not during a test.
- **F3-R4.** The author can add/edit questions by hand; they go through the same validator.
- **F3-R5.** Question metadata: `skill_id`, `difficulty` (0–1), `guess` (mcq = 1 / number of options; short = 0.10; open = 0.05), `slip` (0.10 by default), `status`, links to the generation/validation runs.
- **F3-R6.** Minimum pools: ≥ 4 `validated` questions per skill in the `node` pool for each node; ≥ 3 per skill per course in the `exam` pool.
- **F3-R7.** The tutor has **no access** to `answer_key` and does not see the `exam` pool (P6).

### F4. Audit and publication

Course-version states: `draft → auditing → changes_requested | ready_to_publish | expert_review → published`; `archived`.

- **F4-R1 (stage 0, deterministic).** Graph validation (F1-R3) and calculation of the **volume cap** `volume_cap` from the number of nodes and questions. Defaults (configurable; calibration — OQ-5): nodes < 6 → cap 3; < 12 → cap 6; < 20 → cap 9; ≥ 20 → cap 10 (D-08).
- **F4-R2 (stage 1, conformity gate).** An LLM checks whether the content matches the course's declared description and target level. On mismatch the version goes back to `changes_requested` with a list of mismatches (D-07).
- **F4-R3 (stage 2, skill verification).** An LLM checks that every declared skill is covered by the content; uncovered skills are flagged to the author (D-13).
- **F4-R4 (stage 3, scoring).** Two axes (D-07): **level** — `junior | middle | senior | expert` — and **hardness** `hardness ∈ [0,1]` (depth of theory, trickiness of questions, edge-case coverage). For stability N = 5 runs are executed with structured output; the median is taken and all runs are stored (`llm_runs`).
- **F4-R5 (formula).** Band by level: junior [1,3], middle [4,6], senior [7,9], expert → candidate for 10. `ai_score = band_min + round(hardness × (band_max − band_min))`. A course that does not reach even junior-level depth gets 1. `final = min(ai_score, volume_cap)` (D-08). Parameters live in config; the formula is subject to calibration (OQ-5).
- **F4-R6 (rating 10).** If `final` would be 10, auto-publication is blocked and the version moves to `expert_review`; the author gets a notification that the course is a candidate for the top rank and is under review. An admin assigns an expert (D-03); the expert fills in a checklist. `approved` → rating 10. `rejected` → the author gets a detailed checklist and chooses: keep improving, or publish with a 9 (cap).
- **F4-R7 (transparency for the author).** The author sees the rating, level, hardness, per-category feedback and the skill-verification result, and can update the course before final publication to change the score (D-09). Exact thresholds and internal formulas are not shown. Limit — 5 audit runs per version (🟡 D-09b).
- **F4-R8.** The student sees the course rating from the very start (D-07).

### F5. Learning engine

- **F5-R1.** The mastery vector is stored **per skill** (`skill_mastery.p_known`), D-13, D-14.
- **F5-R2 (BKT).** Update after an answer with `guess` and `slip`:
  - if the answer is correct: `P' = P(1−slip) / [P(1−slip) + (1−P)·guess]`;
  - if the answer is wrong: `P' = P·slip / [P·slip + (1−P)(1−guess)]`;
  - learning: `P_new = P' + (1−P')·learn`.
  Initial values (D-14): `p_init = 0.20`, `learn = 0.15`, `slip = 0.10`, `guess` per F3-R5. All values live in config.
- **F5-R3.** **Node test**: random questions from the `node` pool for the node's skills, ≥ 3 questions per skill (with BKT, at least two correct answers per skill are needed to reach the threshold). A node is passed when after the test **all** its skills have `p_known ≥ 0.80` (D-11).
- **F5-R4.** Attempts: a round consists of 2 attempts; after the second failed attempt in a round a pause of about 24 h applies (`NODE_COOLDOWN`), then a new round. Between the two attempts of a round the student can go back to the theory and use the tutor (remediation). Retries draw new questions from the pool; already-shown questions repeat only when the pool is exhausted (D-11; interpretation: the pause applies after an exhausted round).
- **F5-R5.** A node becomes `available` when all prerequisites are passed (F1-R2); otherwise `locked`.
- **F5-R6.** Practice exercises (questions in `practice` mode) are free, have unlimited attempts and **do not affect** BKT or node progress (they only provide learning context for the tutor). Decision delegated (🟦 D-14).
- **F5-R7.** Every answer is written to `assessment_items`, and every change of `p_known` to `mastery_history` (research logging, P5).

### F6. AI tutor

- **F6-R1.** Active only in learning mode (nodes, exercises, remediation). **Disabled during the final exam.**
- **F6-R2 (context, D-15).** Search in pgvector **only among the chunks of the current node and of prerequisites the student has already passed**; the filter `node_id IN (allowed_set)` is applied in SQL, not in the prompt.
- **F6-R3.** The tutor receives the question text and the student's answer, **never** the answer key or rubric (P6, F3-R7).
- **F6-R4 (hint ladder).** Level 1 — a leading question; 2 — a pointer to a concept/section of the notes; 3 — a worked analogous example. No direct answers.
- **F6-R5 (guard).** Before display, a cheap judge-LLM checks whether the reply gives away the solution. A violation → the hint is regenerated at a lower level or replaced by a static hint.
- **F6-R6 (fallback).** An API failure or a guard violation → the author's static hints (`static_hints`); the system does not crash.
- **F6-R7 (security).** Author content is treated as untrusted data: delimiters in the prompt, a ban on following instructions found in content, no tools for the tutor.
- **F6-R8.** Every message is logged: hint level, guard verdict, used chunks, `llm_run_id`.

### F7. Recommendations

- **F7-R1.** Daily, for each active user, the 7-day and 30-day metrics (mastery trend, weak skills, missed activities, failures) are computed by a **SQL query** (D-16).
- **F7-R2.** One LLM call per user per day phrases up to **three** tips from these aggregates; no spam: a limit of 3/day, skipped when nothing changed.
- **F7-R3.** Shown on the dashboard. For the demo — seed data and a "run now" button (D-16, D-32).

### F8. Final exam

- **F8-R1.** Available when all course nodes are passed. Desktop only (D-22) and only with a camera (D-22/27); before the start, a pre-check: camera, fullscreen, lighting, consent (F9-R1).
- **F8-R2 (parameters, 🟦 D-18).** Number of questions / total time limit by rating: 1–3 → 20 / 45 min; 4–6 → 30 / 60 min; 7–10 → 40 / 90 min. Per-question limit: `mcq`/`short` — 90 s; `open` — 5 min. Questions come from the `exam` pool proportionally to skills; order is random; each question is shown on its own with no going back (🟡 D-18b).
- **F8-R3.** Timers run on the server; answers are autosaved; the result is computed automatically (`open` — LLM against the rubric).
- **F8-R4.** The pass mark is **70 %** (D-18). The result is broken down by skill.
- **F8-R5.** Attempts: 2 attempts per round; once exhausted, a 7-day pause (D-18).
- **F8-R6 (interruption).** A technical interruption (network, camera) stops the test **without a strike** (D-20). Limits: ≤ 2 interruptions per attempt; on resumption the question set is drawn again at random from the pool so a student cannot peek and restart; exceeding the limit → the attempt counts as used.
- **F8-R7.** Per-skill levels for the certificate: ≥ 90 % — "mastered perfectly", 70–89 % — "good", < 70 % — "needs work" (D-25).

### F9. Proctoring and integrity

"Zero trust" here means **deterrence and evidence**, not a guarantee: browser-based proctoring cannot rule out a second device, a virtual machine or remote access. The thesis must say so honestly.

- **F9-R1.** Before the exam — explicit consent to frame capture and checking; without a camera the exam is impossible (D-27).
- **F9-R2 (hard events → automatic strike, D-19).** Leaving fullscreen, losing window focus (after a short grace period), attempting to open devtools, copy/paste. The attempt is stopped and the student gets a strike with an appeal button.
- **F9-R3 (soft signals → admin).** Vision results, keystroke anomalies and other probabilistic signals accumulate in a `risk_score` and go into the admin queue; a strike only after confirmation.
- **F9-R4 (frames, D-21, D-23).** In the browser, MediaPipe checks about every 2–3 s for the presence/number of faces and head turn, without sending data to the server. Once a minute at a random moment (`SNAPSHOT_INTERVAL = 60 s`, with jitter) a frame goes to the server: comparison against the reference photo taken at exam start (a dedicated service, not a Vision-LLM) and a Vision check (phone, second person, gaze away). The frame is deleted immediately after the check.
- **F9-R5 (keystroke, D-24).** Only the intervals between key presses are collected, without the characters: pasting, or typing that is too fast or too uniform with no corrections → a soft signal. No automatic ban.
- **F9-R6 (strikes, D-19).** 1st confirmed strike → exam ban for 7 days, 2nd → 30 days, 3rd → permanent. The ban applies **only to exams**; learning stays available. Appeal exists and is reviewed by an admin.
- **F9-R7 (evidence).** Only frames that triggered an event are stored, encrypted, with an `expires_at` (30 days by default, OQ-8), and deleted after expiry or once the appeal is resolved; clean frames are not stored (D-27).
- **F9-R8.** All strike decisions are made by the server from the event log (P1).

### F10. Certificate

- **F10-R1 (content, D-25).** Course and version, difficulty rating, overall score, date, **per-skill levels** (perfect / good / needs work) and a short text description generated by an LLM from these levels at issue time. **No photo and no biometrics.**
- **F10-R2 (protection, D-26).** The payload (canonical JSON) is signed with the platform's Ed25519 key. It contains a random `certificate_id`, a `kid` and a SHA-256 of the payload for display. Public keys are served under `/.well-known/`.
- **F10-R3.** A public page `/verify/<id>` (the QR code points there): verifies the signature, shows the data and the status `valid | revoked`. No account needed (D-03).
- **F10-R4.** Revocation by an admin with a reason; a revoked certificate is shown as invalid.
- **F10-R5.** PDF export — from the HTML version (print to PDF); optional for v1.

### F11. Admin panel

- Users and roles; expert assignment; course review queue; soft-violation queue; appeals; certificate revocation; viewing `llm_runs` and cost; configuration and demo mode.

## 6. Cross-cutting requirements

- **NFR-1 Language.** Interface and content are in Ukrainian (D-05); project documentation, code and agent instructions are in English (D-34).
- **NFR-2 Privacy.** Biometrics are not stored; frames are processed on the fly; evidence only for triggered events and with a lifetime; consent is mandatory. Research data is anonymized.
- **NFR-3 Observability.** Every LLM call is logged (`llm_runs`: model, parameters, tokens, cost, latency).
- **NFR-4 Security.** Password hashing, rate limiting on LLM/tutor/login, server-side role-based authorization, protection against prompt injection (F6-R7), upload validation.
- **NFR-5 Testability.** Mock providers; a deterministic mode for CI; key flows covered by e2e tests.
- **NFR-6 Demo mode.** `TIME_SCALE` compresses pauses and intervals (a week → minutes); seed courses and users; "run now" for scheduled jobs (D-32).
- **NFR-7 Cost.** Budget limits per user/day for the tutor and generation; accounting in `llm_runs`.
- **NFR-8 Accessibility.** Basic: keyboard navigation, contrast, field labels (no claim of full WCAG conformance).

## 7. Decision log

| ID | Decision | Status |
|---|---|---|
| D-01 | IT courses only | ✅ |
| D-02 | Practice = multiple-choice, short and open answers (LLM against a reference/rubric); no code execution | ✅ |
| D-03 | Roles: student, author, expert, admin; admin assigns experts; employer = public verification page only | ✅ |
| D-04 | Video is added (≈10 for the demo), off-the-shelf player; transcript mandatory | ✅ (transcript — 🟦) |
| D-05 | Language is Ukrainian (UI and content); payments postponed | ✅ |
| D-06 | Course versioning: a published version is immutable, a new version → new audit, certificate bound to a version | ✅ |
| D-07 | Audit: description-conformity gate → two axes (level and hardness) → rating 1–10; the student sees the rating at the start | ✅ |
| D-08 | `final = min(AI score, volume cap)` | ✅ |
| D-09 | The author sees the score and can update the course before publication | ✅ |
| D-09b | Limit of 5 audit runs per version; exact thresholds hidden | 🟡 |
| D-10 | Experts are simulated (accounts assigned by an admin; review queue) | ✅ |
| D-11 | Node test: 80 % threshold; a round of 2 attempts; ≈24 h pause after an exhausted round; remediation with the tutor; new questions | ✅ (interpretation of the pause — to clarify during implementation) |
| D-12 | Prerequisites — AND | ✅ |
| D-13 | The author lists skills, the AI verifies coverage; mastery is per skill | ✅ |
| D-14 | BKT per skill with the defaults in F5-R2; practice exercises do not affect BKT | 🟦 |
| D-15 | Tutor: RAG over the current node + passed prerequisites, filter in SQL, hint ladder, guard, fallback | 🟦 |
| D-16 | Recommendations: SQL metrics + LLM phrasing, ≤3/day; simulated for the demo | ✅ |
| D-17 | Questions are produced by a separate generator, checked by a separate validator, pools `node/exam/assessment` | ✅ (role separation — 🟦) |
| D-18 | Exam: 2 attempts + 7 days; pass mark 70 %; number of questions/time by rating | ✅ (parameters — 🟦) |
| D-18b | Exam without going back to previous questions | 🟡 |
| D-19 | Violations: hard → automatic strike; soft → via admin; ban 7 d → 30 d → permanent, exams only; appeal | ✅ |
| D-20 | A technical interruption is not a strike; ≤2 interruptions; new question set on resumption | ✅ (limits — 🟦) |
| D-21 | One snapshot per minute at a random moment (the original description said every 10–25 s) | ✅ |
| D-22 | Exam on desktop only | ✅ |
| D-23 | Two-tier proctoring: MediaPipe locally + server frame check; `ProctorProvider` with a Mock | 🟦 |
| D-24 | Keystroke — intervals only, soft signal, no automatic ban | ✅ |
| D-25 | Certificate: course, version, rating, score, per-skill levels, LLM description; no photo | ✅ |
| D-26 | Ed25519 signature + public verification + revocation | 🟦 |
| D-27 | Store nothing except evidence for triggered events, with a lifetime; no camera → no exam | ✅ |
| D-28 | Code sandbox is out of scope | ✅ |
| D-29 | Research question — learning effectiveness (mastery gating + AI tutor), not auditor accuracy | ✅ |
| D-30 | Experiment design: within-subject (each participant does two topics, one with the method and one without, order counterbalanced) | 🟡 |
| D-31 | Simulation is allowed only as a supplement and honestly labeled synthetic; main claims rest on real participants | ✅ |
| D-32 | Configuration and demo mode (`TIME_SCALE`) | 🟦 |
| D-33 | A reduced core is implemented for the experiment (M00–M07); the rest stays in the full spec and later milestones | 🟦 |
| D-34 | Project documentation, code, identifiers and agent instructions are in English; product UI and course content stay in Ukrainian | ✅ |

## 8. Open questions

- **OQ-1.** Which LLM providers and models (generation, audit, tutor, Vision), and the budget.
- **OQ-2.** Embedding model and dimension (Ukrainian support).
- **OQ-3.** Confirmation of the experiment design (D-30), the topic(s) and the amount of learning content.
- **OQ-4.** Formal department requirements for the master's thesis (length, implementation, approval of the experiment).
- **OQ-5.** Calibration of the `volume_cap` thresholds and the rating formula.
- **OQ-6.** Calibration of the 0.7 threshold for open answers and the rubrics.
- **OQ-7.** Deployment target for the demo (Vercel + Supabase or AWS).
- **OQ-8.** Retention period for evidence (30 days by default).
- **OQ-9.** Whether pairwise comparisons against anchor courses are needed in the audit (v2).
- **OQ-10.** Exact interpretation of the pause between attempt rounds (D-11).
- **OQ-11.** Strictness of the BKT threshold. With the defaults (`p_init=0.20`, `learn=0.15`, `slip=0.10`, `guess=0.25`), the sequence "correct, correct, wrong" gives ≈ 0.51 (fail), "correct ×3, wrong" ≈ 0.79 (a narrow fail), and "correct, wrong, correct, correct" ≈ 0.88 (pass). So the outcome depends on order, and one mistake on 3 questions almost always fails the skill. Decide: more questions per skill, higher `p_init`/`learn`, a lower threshold, or accept as is. Calibrate on pilot data in M05.

## 9. Glossary

- **BKT** — Bayesian Knowledge Tracing, a probabilistic model of skill acquisition with `slip` and `guess`.
- **Mastery gating** — access to later topics depends on demonstrated understanding (≥ 0.80).
- **HITL** — human-in-the-loop, manual review by an expert.
- **Pool** — a set of questions for a specific purpose (`node`, `exam`, `assessment`).
- **Strike** — a confirmed integrity violation with the consequences defined in F9-R6.
