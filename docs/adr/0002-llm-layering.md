# ADR-0002: LLM layering

- `LLMProvider` is the thin adapter interface (raw call, returns unvalidated output + usage); `MockLLMProvider` is the first one.
- `LLMClient` is the only entry point for app code: it validates against the Zod schema (P3), caches by prompt hash, and logs every call (also cache hits and schema failures) to `llm_runs` (NFR-3).
- The cache is in-memory in M00 (`LLMCache` interface); a persistent cache can replace it later without touching callers.
