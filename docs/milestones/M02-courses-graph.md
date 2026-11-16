# M02 — Courses, knowledge graph, import

**Depends on:** M01 · **SPEC requirements:** F1 (R1–R6), D-06, D-12, D-13

## Goal
A course model as a versioned DAG of skills and nodes, with JSON import and a graph view.

## Scope
- Tables: `courses`, `course_versions`, `skills`, `nodes`, `node_edges`, `node_skills`.
- A JSON import schema (Zod): course, skills, nodes with skills, edges; a CLI and an admin import endpoint.
- Deterministic graph validation (F1-R3): acyclicity (Kahn), roots, reachability, no isolated nodes, ≥1 skill per node. Returns a **list** of errors.
- Versioning rules: a published version is immutable; creating a new version copies the graph (without publishing).
- A graph view (React Flow, read-only) with placeholder node states.
- Seed course: a small demo course (≈8 nodes, 2–3 skills per node) in Ukrainian.

## Out of scope
The visual editor (M08), content and questions (M03, M04), the audit (M08).

## Acceptance criteria
- [ ] The validator finds a cycle, an isolated node, an unreachable node and a node without a skill (separate unit tests)
- [ ] Invalid JSON on import returns a list of errors and saves nothing (transactional)
- [ ] An attempt to change a published version is rejected by the server
- [ ] A new version copies the graph, skills and nodes; the `parent_version_id` link is kept
- [ ] The seed course graph renders correctly

## Tests
Unit: graph validator (a table of cases). Integration: import, the immutability rule. e2e: viewing the graph.
