# ADR-0008: Claude API for generation, Voyage for embeddings

Status: Accepted

## Context
The pipeline needs structured generation (distill/connect/reviews/ask) and embeddings (retrieval). Anthropic does not offer an embeddings API and recommends Voyage.

## Decision
- Generation: Claude — `claude-sonnet-5` for high-volume structured work (distill, connect, ask, daily reviews), `claude-opus-4-8` for weekly review synthesis. Centralized in `convex/ai/models.ts`.
- Embeddings: `voyage-3.5`, 1024 dimensions, stamped with `embeddingVersion` for migratable indexes.
- All calls from Convex actions only; forced tool-use JSON for anything that becomes proposal ops, validated by the same runtime checker as the mutation boundary.

## Consequences
- Two provider dependencies; both degrade gracefully (05 §5 — the app is fully usable without AI).
- Prompt templates versioned (`PROMPT_VERSION`); no version ships without a logged eval run (05 §6).
- Model swaps are one-line + measurable via `aiRuns` token/approval data.
- Cost bounded by per-user daily budget with honest refusal copy; auto-distill off by default.
