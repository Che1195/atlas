# 02 — Technical Architecture

## 1. Challenge to the vision's layer diagram

The vision lists 8 layers (Mobile App → Application API → Domain Layer → Database → Knowledge Engine → AI Layer → MCP Server → Hermes Agent). Treated as deployment topology, that creates 8 places for logic to hide and violates the vision's own "business logic exists exactly once." This spec keeps the *responsibilities* but collapses them into **3 deployable pieces**, with Convex as the single home of domain logic.

```
┌─────────────────────────────┐   ┌──────────────────────────────┐
│  Next.js PWA (Vercel)       │   │  Hermes = Claude app / Code   │
│  UI only. No business logic │   │  (post-MVP: in-app chat UI)   │
└──────────────┬──────────────┘   └───────────────┬──────────────┘
               │ Convex client (Clerk JWT)        │ MCP (Streamable HTTP,
               │                                  │ bearer API key)
┌──────────────▼──────────────────────────────────▼──────────────┐
│  CONVEX DEPLOYMENT (one per env: dev / prod)                    │
│                                                                 │
│  HTTP router: /mcp endpoint (MCP server, httpAction)            │
│  Public functions: queries/mutations/actions (auth-checked)     │
│  Internal functions: AI pipeline actions, crons                 │
│  convex/lib/: pure domain logic (confidence, proposal ops,      │
│               provenance, retrieval ranking) — unit-testable    │
│  Tables + indexes + vector indexes (04-database-schema)         │
│  Scheduler: crons for reviews, budget reset                     │
└───────────────┬───────────────────────────┬────────────────────┘
                │                           │
        ┌───────▼────────┐          ┌───────▼────────┐
        │  Claude API    │          │  Voyage API    │
        │  (generation)  │          │  (embeddings)  │
        └────────────────┘          └────────────────┘
```

Vision-layer → implementation mapping:

| Vision layer | Lives in |
|---|---|
| Mobile Application | Next.js PWA |
| Application API | Convex public functions (typed, generated client) |
| Domain Layer | `convex/lib/` pure modules + mutation bodies |
| Database | Convex tables |
| Knowledge Engine | `convex/lib/` (confidence, dedup, graph ops) + `applyProposal` mutation |
| AI Layer | Convex internal actions calling Claude/Voyage |
| MCP Server | Convex `httpAction` at `/mcp` (same deployment, same functions) |
| Hermes Agent | External MCP client (MVP); in-app agent later (07-hermes) |

## 2. Piece responsibilities

### Next.js PWA (Vercel)
- App Router, React, Tailwind v4, Clerk components, Convex React client.
- Renders state, collects input, calls Convex functions. **Zero domain rules** — if a component needs to know "when is confidence `mixed`", that logic is exported from a shared pure module, not reimplemented.
- PWA: installable manifest, push-only/offline-fallback service worker (no shell caching — playbook), local draft persistence for capture resilience.

### Convex deployment
- **Public functions** (`convex/*.ts`): every one begins by resolving `ctx.auth` → user doc; every query filters by that user's id via index. Grouped by domain: `entries.ts`, `knowledge.ts`, `proposals.ts`, `experiments.ts`, `reviews.ts`, `search.ts`, `apiKeys.ts`, `issues.ts`, `account.ts`.
- **Internal functions**: AI pipeline actions (`ai/distill.ts`, `ai/connect.ts`, `ai/review.ts`, `ai/embed.ts`) — never callable from clients; invoked by mutations, scheduler, or crons.
- **`convex/lib/`** (pure, no ctx, injected time): `confidence.ts`, `proposalOps.ts` (op validation + application planning), `dedup.ts`, `retrieval.ts` (rank/merge search results), `reviewSections.ts`. This is where unit tests concentrate.
- **`/mcp` HTTP endpoint**: MCP Streamable HTTP server as a Convex `httpAction`. Authenticates bearer API key → user id, then calls the *same internal logic* as the app functions with an explicit acting-user context. No parallel implementation. (06-mcp-interface.)
- **Crons**: hourly review-generation tick (fires per-user by local-time cadence), daily AI-budget reset, embedding backfill.

### AI providers
- Claude API: distillation, connection/contradiction, review generation, Ask synthesis. Called only from Convex actions; keys live in Convex env vars, never in the client. Model/prompt versions recorded on every run (05-ai-pipeline).
- Voyage API: embeddings for entries + knowledge statements; stored in Convex vector indexes.

## 3. Environments

Convex's built-in split satisfies the playbook's two-database rule:
- `dev` deployment: local development (`npx convex dev`), E2E target, AI calls allowed but budget-capped low.
- `prod` deployment: `npx convex deploy` from the pipeline only.
- Vercel: preview deployments point at dev Convex; production points at prod. Clerk: separate dev/prod instances.
- Env vars per deployment: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, budget knobs.

## 4. Data flow — the core loop

1. **Capture:** user (PWA) or Hermes (MCP `atlas_create_entry`) writes an entry → mutation stores it, schedules `ai/embed`.
2. **Distill:** user taps Distill (or auto mode) → `ai/distill` action: loads entry + retrieved related knowledge → Claude structured output → **proposal** row (ops + rationale + citations). Nothing else is written.
3. **Review:** review queue renders proposal ops as cards → user approves/edits/rejects per op → `applyProposal` mutation applies approved ops **in one transaction**: creates/updates knowledge, evidence, relationships; writes a revision per touched object; marks proposal resolved.
4. **Connect:** post-apply, `ai/connect` retrieves semantically near knowledge → may emit a follow-up proposal (relationships, contradiction flags, pattern suggestions).
5. **Test:** user spawns an experiment from an object; recording its outcome auto-drafts an evidence proposal against the tested object.
6. **Distill (macro):** crons generate daily/weekly reviews from the period's deltas.

## 5. Key architectural rules

- **Single writer:** `applyProposal` is the only code path that materializes AI-originated ops. User-originated direct edits (their own manual knowledge edits) share the same op-application lib so revision/provenance behavior is identical.
- **Actions vs mutations:** Claude/Voyage calls happen in actions (non-transactional); all writes happen in mutations the action schedules/calls. An action crash can never leave partial knowledge writes.
- **Typed contracts end-to-end:** Convex validators + generated client types; shared TS types for proposal ops in `convex/shared/` imported by both PWA and MCP layer. No `any`.
- **Idempotency:** pipeline actions take an explicit `runId`; re-runs upsert by `runId` instead of duplicating proposals.
- **Time:** pure lib functions take time/timezone as parameters. `Date.now()` only at the edges (mutations/actions).
