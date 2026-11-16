# M10 — Proctoring and strikes

**Depends on:** M09 · **SPEC requirements:** F9 (R1–R8), D-19…D-24, D-27, NFR-2

## Goal
Exam integrity: deterrence and evidence, fair strikes with an appeal, and minimal data storage.

## Scope
- Tables `proctor_events`, `proctor_evidence`, `strikes`.
- Client: forced fullscreen; detecting leaving fullscreen/losing focus (grace period), copy/paste, devtools attempts (heuristic); a desktop check.
- MediaPipe in the browser (~every 2–3 s): presence/number of faces, head turn; no video is transmitted.
- A snapshot scheduler: once per `SNAPSHOT_INTERVAL` (60 s) at a random moment (jitter).
- `ProctorProvider` (`Real` and `Mock`): comparison with the reference photo from the start (a dedicated service) + a Vision check (phone, second person, gaze away). The frame is deleted immediately.
- Keystroke: intervals only; signals "paste", "too fast/too uniform".
- `risk_score`; **hard → strike automatically, soft → admin queue**; ladder 7 d → 30 d → permanent, exams only.
- Appeal and admin review; evidence frames only for triggered events, encrypted, `expires_at`; a retention job.
- Consent before the exam; the exam does not start without a camera.
- A technical interruption ≠ a strike.

## Out of scope
Document verification, liveness, screen recording, detecting virtual machines/a second device.

## Acceptance criteria
- [ ] A hard event stops the attempt and creates a strike; a soft signal does **not** create a strike without admin confirmation
- [ ] The ladder 1st/2nd/3rd strike gives 7 days / 30 days / permanent (unit test)
- [ ] Clean frames are stored nowhere (test: after a run there are no rows in `proctor_evidence`/storage without an event)
- [ ] `proctor_evidence` after `expires_at` is deleted by the retention job together with the file
- [ ] The ban applies only to exams; learning stays available
- [ ] Mock scenarios (normal, second person, phone) play out in e2e
- [ ] A technical interruption is not counted as a violation

## Tests
Unit: risk scoring, strike ladder, keystroke heuristics. Integration: providers on the Mock, retention. e2e: violation scenarios in demo mode.

## Notes for the agent
Do not claim in the UI or documentation that the system "makes cheating impossible"; this is deterrence and evidence (SPEC, F9).
