# Milestones

The order deliberately builds the **experiment core first** (M00–M07), so that early on there is a system the research can run on. After that comes the rest of the platform (M08–M12) and the final evaluation (M13).

| # | Name | Block | Depends on |
|---|---|---|---|
| M00 | Project scaffold and infrastructure | core | — |
| M01 | Authentication and roles | core | M00 |
| M02 | Courses, knowledge graph, import | core | M01 |
| M03 | Content, transcripts, embeddings | core | M02 |
| M04 | Question bank (generator and validator) | core | M03 |
| M05 | Learning engine (BKT, gating) | core | M04 |
| M06 | AI tutor with RAG | core | M03, M05 |
| M07 | Experiment instrumentation | core | M05, M06 |
| M08 | Audit, publication, author editors | platform | M02–M04 |
| M09 | Exam engine | platform | M05 |
| M10 | Proctoring and strikes | platform | M09 |
| M11 | Certificate and verification | platform | M09 |
| M12 | Recommendations and demo mode | platform | M05 |
| M13 | Evaluation and thesis materials | wrap-up | M07 (and others as needed) |

## Rules for all milestones

- One milestone — one branch and one PR review by a human.
- Acceptance criteria are the definition of done. Do not close a milestone until all of them are met.
- A gap or contradiction in the SPEC → an entry in `SPEC.md`, "Open questions", and a question to the human.
- Decisions delegated to the agent within a milestone are recorded in a short ADR in `docs/adr/`.
- Each milestone adds the research events that belong to its module (P5).

## Milestone file template

`Depends on` · `SPEC requirements` · `Goal` · `Scope` · `Out of scope` · `Acceptance criteria` · `Tests` · `Notes for the agent`.
