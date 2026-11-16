# M09 — Exam engine

**Depends on:** M05 · **SPEC requirements:** F8 (R1–R8), D-18, D-18b, D-20, D-22, P1

## Goal
A final exam without hints, with server-side timers, autosave and a per-skill result breakdown.

## Scope
- Eligibility: all nodes passed; a ban check (field `exam_ban_until`, flag `exam_banned_forever`).
- Set assembly from the `exam` pool proportionally to skills; question count and time by rating (F8-R2); per-question limits.
- One question shown at a time, with no going back (D-18b); autosave of answers.
- Server-side deadlines; answers after the deadline are rejected.
- Grading: automatic for `mcq`/`short`, LLM against the rubric for `open`; per-skill result; 70 % threshold.
- Attempt rounds: 2 attempts, after exhaustion a 7-day pause (`TIME_SCALE`).
- Interruptions: ≤2 per attempt, no strike, a new question set on resumption; exceeding the limit — the attempt counts as used.
- Tutor is forbidden during the exam.
- A results page with a per-skill breakdown and levels (perfect/good/needs work).
- A pre-check screen (a skeleton; the camera and fullscreen are connected in M10).
- Ban check before the start (strike data comes from M10; here only the fields and the check).

## Out of scope
Proctoring and strikes (M10), the certificate (M11).

## Acceptance criteria
- [ ] The client cannot extend the time (test: an answer after the deadline is rejected)
- [ ] The question set matches the rating (counts and limits from config)
- [ ] The per-skill result is correct on a fixture; the 70 % threshold works at the boundary
- [ ] Interruption: after the limit is exceeded the attempt is counted; on resumption the set is different
- [ ] After two failures a 7-day pause applies (fake clock)
- [ ] The tutor is unavailable in the exam

## Tests
Unit: set assembly, scoring, skill levels. Integration: timers, interruptions, rounds. e2e: taking the exam.
