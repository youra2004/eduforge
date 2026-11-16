# M03 — Content, transcripts, embeddings

**Depends on:** M02 · **SPEC requirements:** F2 (R1–R4), D-04, D-15, P4

## Goal
Node content (text and video), mandatory transcripts, and embedding search with a hard node filter.

## Scope
- `content_items` (markdown and video), `content_chunks` (`vector`, HNSW index).
- Markdown rendering (code blocks, images); video through an off-the-shelf player (Plyr/react-player); mp4 in storage or an external link.
- Rule: a video lesson without a transcript fails publication validation.
- A transcription job (Whisper adapter + Mock): fills `transcript_text`, `transcript_source='whisper'`.
- A chunking and embedding job (through `LLMProvider`/an embedding provider), idempotent.
- A function `retrieve({ allowedNodeIds, query, k })` with the filter applied in SQL.
- A minimal UI for adding/editing node content.

## Out of scope
Question generation (M04), the tutor (M06), a full editor (M08).

## Acceptance criteria
- [ ] `retrieve` **never** returns chunks from nodes outside `allowedNodeIds` (test on a mixed dataset)
- [ ] A video lesson without a transcript blocks publication validation
- [ ] Re-running chunking does not duplicate chunks (idempotency)
- [ ] Changing content re-indexes only the changed node
- [ ] The video plays in the player and the transcript is visible next to it

## Tests
Unit: chunking. Integration: retrieve + filter, idempotency, transcription on the Mock.

## Notes for the agent
Vector dimension comes from config (OQ-2). Do not log raw chunk text into `llm_runs` unless needed (use hashes and ids).
