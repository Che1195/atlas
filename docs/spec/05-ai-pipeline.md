# 05 — AI Pipeline

All AI work runs in Convex internal actions, writes only via mutations, and can only materialize knowledge through proposals (invariant #2). Every run is logged to `aiRuns` with model + prompt version + token counts.

## 1. Stages

```
capture ──► embed ──► distill ──► [user review] ──► apply ──► connect ──► [user review]
                                                      │
experiments/outcomes ─────────────────────────────────┤ (evidence proposals)
                                                      ▼
                                            reviews (cron: daily/weekly)
                                            ask (on demand, read-only)
```

### embed
- Trigger: entry create/edit; knowledge create/statement-change (post-apply).
- `text-embedding-3-small` (`dimensions: 1024`); same embedding call for stored texts and search-time queries (no separate document/query mode).
- Stored on the row; `embeddingVersion` stamped. Backfill cron sweeps rows where version ≠ current.

### distill (entry → proposed knowledge)
- Trigger: user taps **Distill** on an entry; or auto on entry create if `settings.autoDistill` (default off — cost + user control). Since ADR-0012, this server-side path is a **dormant fallback** — the primary way proposals get drafted is a connected MCP client (ChatGPT/Codex) reasoning over `atlas_retrieve_context` and calling `atlas_submit_proposal` itself. The button stays wired and honest: it requires an explicit `OPENAI_API_KEY` on the live path (never silently stubbed) and reports a plain "unavailable — use your connected assistant" state otherwise (Phase M Task 2).
- Context assembly: the entry; the user's active knowledge nearest by vector to the entry (top 12 statements with type + confidence); the entry's recent siblings (±7 days, titles only).
- One model call (per §2), structured JSON output → `ProposalOp[]` + rationale + citations (entry excerpt per op).
- **Conservatism contract** (in prompt, tested by evals): propose 0–4 ops per entry; prefer `addEvidence` on existing knowledge over `createKnowledge` near-duplicates (the top-12 context exists precisely to enable this); never propose confidence; never propose for trivial/logistical entries — an empty proposal is a valid output and is not stored.
- Writes one `proposals` row (idempotent by `runId = distill:{entryId}:{promptVersion}`). Re-distilling an entry supersedes the prior pending proposal.

### connect (post-apply graph maintenance)
- Trigger: after `applyProposal` creates/updates knowledge.
- Retrieval: top-K vector neighbors of each touched object among active knowledge.
- The model judges candidate pairs → may emit one follow-up proposal: `createRelationship` ops (incl. `contradicts`), `addEvidence` cross-links, and — when ≥3 distinct-source supports exist across sibling insights — a `createKnowledge(type: pattern)` + `generalizes` bundle.
- **Contradiction surfacing lives here:** a proposed `contradicts` relationship or contradicting evidence pins the affected object to the top of the review queue with a distinct treatment. Silence is a valid output.

### outcome evidence
- No model call. Recording an outcome mechanically drafts a proposal: `addEvidence(knowledge: tested object, sourceType: 'outcome', stance: from result)`. The user may retarget/edit before approving (03 §6).

### reviews (cron)
- Hourly tick scans users whose local time crosses their cadence boundary (daily: configurable hour, default 21:00; weekly: Sunday).
- Input is **computed, not hallucinated**: the period's applied revisions, new knowledge, confidence transitions (from revision snapshots), resolved/expired proposals, experiment activity, evidence adds — assembled by pure lib `reviewSections.ts`. Post Phase M (ADR-0012), the cron writes the computed `sections` fields only — `sections.prose` and the `recurringThemes` grouping are **on-demand**, generated when the user asks their connected MCP client to write them (via `atlas_get_review`'s structured sections), not by a server model call; a review with unwritten prose is a normal, complete state, not an error.
- Style contract (for whichever assistant writes the prose, client-side): factual, second person, no praise, no motivational language, no advice unless an active experiment implies a next observation.
- Skip rule: if the period has zero deltas, write a review with empty sections; never invent content.

### ask (search-time synthesis, read-only)
- Query → embed → vector + full-text search over knowledge and entries (merged/ranked in `lib/retrieval.ts`) → the model synthesizes an answer **only from retrieved items**, citing ids; UI renders citations as links. No writes. Same path serves MCP `atlas_retrieve_context` (which returns the bundle *without* synthesis — the calling assistant does its own reasoning; 06 §3).

## 2. Models

| Task | Model | Why |
|---|---|---|
| distill, connect, ask | `gpt-5.6-terra` | High-volume, structured, cost-sensitive |
| reviews (weekly) | `gpt-5.6-sol` | Weekly synthesis quality is user-facing spine; low volume |
| reviews (daily) | `gpt-5.6-terra` | Mostly computed input, light prose |
| embeddings | `text-embedding-3-small` (`dimensions: 1024`) | 1024 dims matches locked schema; verify current model at Phase 3b |

Centralized in `convex/ai/models.ts`; changing a model = one-line change + `aiRuns` records make A/B comparison possible. Prompt templates live in `convex/ai/prompts/` with a `PROMPT_VERSION` const per template; version bumps on any semantic change.

## 3. Structured output discipline

- Calls use the Responses API's structured-output mode (`json_schema`, `strict: true`) with a schema mirroring `ProposalOp[]`; response validated by the same `proposalOps` checker used at the mutation boundary. Invalid → one retry with the validation error appended → on second failure, log `aiRuns.error`, write no proposal, surface in the ops panel.
- Op post-filters (code, not prompt-trust): statement ≤ 280 chars; cited `sourceId`s must exist and belong to the user; `new`-refs in-range; dedup near-identical `createKnowledge` against existing statements (cosine > 0.95 → converted to `addEvidence` suggestion on the existing object).

## 4. Cost control

- Per-user daily token budget (env: `AI_DAILY_TOKEN_BUDGET`, default 300k in prod, 50k in dev) checked before each action; over-budget → run refused with visible message ("AI budget reached for today — Distill will work tomorrow, your entry is saved"). Honest copy rule.
- `aiRuns` is the ledger; a simple ops panel section sums tokens by day/purpose.
- Auto-distill hard-caps at 20 entries/day regardless of budget.

## 5. Failure semantics

- Actions are non-transactional: any crash before the final mutation writes nothing but the `aiRuns` error row. No partial proposals.
- OpenAI outages degrade gracefully: capture, browsing, review queue, manual knowledge edits all work without AI. Distill/Ask buttons show a plain unavailable state.
- Embedding lag is tolerated: search falls back to full-text-only when a row's embedding is missing.

## 6. Evals (see also 11-testing §5)

- Fixture set: ~15 curated sample entries (varied: emotional reflection, logistics-only, conversation paste, repeat-of-earlier-event) with expected-shape assertions: op count ranges, no-proposal-for-trivial, evidence-over-duplicate behavior, no confidence field ever present.
- Review-tone eval: generated reviews for fixture periods checked against a banned-phrase list (praise/motivational lexicon) + one LLM-judge rubric pass.
- Run manually per prompt-version bump (`bun run eval`); results appended to the eval log. Not in CI (cost), but a prompt version may not ship without a logged eval run.
