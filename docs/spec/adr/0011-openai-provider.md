# ADR-0011: OpenAI replaces Claude + Voyage as AI provider (supersedes ADR-0008)

Status: Accepted

## Context
User decision (2026-07-22): switch Atlas's AI provider from Anthropic (Claude for generation, Voyage for embeddings — ADR-0008) to OpenAI, for both generation and embeddings. This supersedes the locked stack choice; it is a provider swap, not a re-opening of the pipeline's design — the proposal gate, structured-output discipline, budget model, prompts, and stub provider are provider-agnostic and unchanged in shape.

## Decision
- Generation: OpenAI Responses API — `gpt-5.6-terra` for high-volume structured work (distill, connect, ask, daily reviews), `gpt-5.6-sol` for weekly review synthesis. Centralized in `convex/ai/models.ts`; the provider client lives in `convex/ai/distill.ts` (and sibling actions as they ship).
- Embeddings (Phase 3b): `text-embedding-3-small` at `dimensions: 1024` — the locked schema's vector dimensions (04-database-schema) survive unchanged; verify the exact model against OpenAI's current lineup when Phase 3b is implemented.
- Env var: `OPENAI_API_KEY` replaces `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` everywhere, including the stub-fallback detection (AI provider is "stub" if unset or `AI_PROVIDER=stub`).
- What deliberately does NOT change: the proposal gate (ADR-0004); structured-output discipline — schema-validated output checked by the same `proposalOps` checker at the mutation boundary (05 §3); the per-user daily token budget and its honest-refusal copy (05 §4); prompt templates and `PROMPT_VERSION` (no prompt text changes for this switch); the stub provider's behavior and selection contract (used in dev/CI).

Model mapping (GPT-5.6 family, released 2026-07-09; pricing/ids researched 2026-07-22 — re-verify if this ADR is read much later):

| Task | Model | Price (per MTok, in/out) | Why |
|---|---|---|---|
| distill, connect, ask | `gpt-5.6-terra` | $2.50 / $15 | High-volume, structured, cost-sensitive — same slot `claude-sonnet-5` filled |
| reviews (weekly) | `gpt-5.6-sol` | $5 / $30 | Weekly synthesis quality is user-facing spine; low volume — same slot `claude-opus-4-8` filled |
| reviews (daily) | `gpt-5.6-terra` | $2.50 / $15 | Mostly computed input, light prose |
| embeddings | `text-embedding-3-small` (`dimensions: 1024`) | verify at Phase 3b | Matches locked schema's vector dims; exact model TBC |

## Consequences
- Single-provider coupling is unchanged in shape: ADR-0008 already coupled generation+embeddings to one vendor family (Anthropic + its recommended embeddings partner); this ADR keeps that shape, now entirely within OpenAI. Both degrade gracefully — the app is fully usable without AI (05 §5).
- OpenAI API data is not used to train OpenAI's models by default, per OpenAI's API/enterprise data-usage policy; documented in the privacy note alongside the existing "no third-party analytics, ever" commitment (08-security-model).
- Model swaps remain one-line changes in `convex/ai/models.ts`, measurable via `aiRuns` token/approval data — this property carries over unchanged from ADR-0008.
- Prompt templates and `PROMPT_VERSION` are untouched by this switch; a model change alone is still recorded per-run in `aiRuns` (05 §2), not a prompt version bump.
