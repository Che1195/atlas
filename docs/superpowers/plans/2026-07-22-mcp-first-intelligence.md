# Phase M — MCP-First Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Atlas becomes the system of record + trust boundary; the user's subscription-covered assistants (ChatGPT via connector, Hermes agent via Codex/MCP) do the model work. Deliver the MCP server (spec 06) with BOTH bearer-key auth (header-capable agents) and OAuth 2.1 + DCR (ChatGPT's mandate), embeddings as the one micro-API cost, an honest Distill-button rework, and the Connections UI. Pulls roadmap Phase 5 forward; reviews-prose and connect-pass move post-MVP.

**Decisions (user 2026-07-22 + accepted defaults):** subscription-first intelligence; embeddings stay server-side (`text-embedding-3-small`, `dimensions: 1024` — pennies); reviews become computed-only with prose on-demand later; server-side distill becomes a dormant fallback (honest "unavailable" without a key — never stub outside explicit `AI_PROVIDER=stub`).

**Researched facts (2026-07-22):** ChatGPT custom connectors (Developer mode, Plus+) accept remote HTTPS MCP servers with **OAuth 2.1 + Dynamic Client Registration mandatory; bearer tokens not accepted**. OpenAI's Responses API and Apps SDK also speak MCP. Codex CLI/agents can send arbitrary headers (bearer OK). MCP transport: Streamable HTTP, stateless JSON mode fits Convex httpActions (spec 06 §4).

## Global Constraints

- Branch `phase-m-mcp-intelligence`. Pipeline + full E2E batch + MCP contract suite before ship. Standard commit trailer.
- **Write asymmetry is the safety model (06 §2):** no MCP tool mutates knowledge/evidence/relationships/experiments directly — `atlas_submit_proposal` → pending proposal only; `atlas_create_entry` is the sole direct write (`source: 'mcp'`, ADR-0009). The contract suite asserts this structurally.
- The httpAction layer contains ONLY auth, rate limiting, and shape translation (invariant #4); tool handlers call internal functions taking explicit `userId` first param. Public-function invariants unchanged; every new PUBLIC function needs an isolation row (internal functions and httpActions don't, but the contract suite covers the MCP surface adversarially).
- Structured MCP errors: `{code: 'not_found'|'forbidden_scope'|'invalid_ops'|'rate_limited'|'unauthorized', message, details?}` (06 §2; `budget_exceeded` reserved).
- Schema additions allowed ONLY as specified in Task 5 (OAuth tables) — everything else uses existing tables. `v.any()` stays schema-only (2 sanctioned).
- Keys/tokens: `atlas_sk_` + 40 hex (CSPRNG) shown once, SHA-256 at rest, prefix for display (08 §3); OAuth access tokens `atlas_oat_` + 40 hex, same hashing; auth codes single-use ≤60s TTL; PKCE S256 required; refresh tokens rotate.
- No model calls anywhere in this phase except `ai/embed` (embeddings) and the dormant distill fallback. Embedding stub for dev/tests: deterministic 1024-dim vector derived from a seeded hash of the input text (unit-normalized) so convex-test and E2E never hit the network.
- UI: MERIDIAN tokens, testids, honest copy. Docs edits surgical.

---

### Task 1: ADR-0012 + spec/roadmap updates (docs only)

**Files:** Create `docs/spec/adr/0012-subscription-first-intelligence.md`; modify `docs/spec/06-mcp-interface.md` (§1 auth), `docs/spec/07-hermes.md` (Hermes = ChatGPT/Codex now), `docs/spec/08-security-model.md` (accepted-risk register row: bearer-only risk RESOLVED by this ADR — OAuth added; note remaining), `docs/spec/12-roadmap.md` (Phase 5 pulled forward as Phase M; 3b remnant = embeddings here, search-UI/connect/reviews-prose re-slotted post-M), `docs/spec/05-ai-pipeline.md` (distill trigger note: server path dormant fallback; reviews prose on-demand), `docs/hermes-persona.md` (create — 07 Phase A persona, GPT-flavored).

- [ ] ADR-0012: user decision; what does the work now (client assistants over MCP; server = embeddings + storage + gate); ChatGPT OAuth mandate fact + source note; bearer keys retained for header-capable agents; dormant distill fallback; cost model (subscription + embedding pennies vs API metering).
- [ ] 06 §1 rewrite: dual auth — bearer `atlas_sk_` AND OAuth 2.1 (AS endpoints, DCR, PKCE, resource metadata RFC 9728) both resolving to the same user+scopes model; delete the "OAuth is post-MVP" line.
- [ ] 07: Phase A clients = ChatGPT app (connector) + Codex/any MCP agent; persona doc extracted to `docs/hermes-persona.md` with the 5 behavior rules verbatim, addressed to a GPT-based client.
- [ ] Commit `ADR-0012: subscription-first intelligence — MCP clients do the model work`.

### Task 2: Distill honesty rework (small, code)

**Files:** `convex/ai/distill.ts`, `convex/ai/provider.ts`, `convex/entries.ts` (distillStatus), `app/(app)/entries/[id]/page.tsx`, tests.

- [ ] Provider selection: `'stub'` ONLY when `AI_PROVIDER==='stub'`; missing `OPENAI_API_KEY` on the live path ⇒ the action finishes error `'no_provider'` WITHOUT any provider call (budget/aiRuns discipline preserved), and `distillStatus` maps it to a new literal `'unavailable'`.
- [ ] Entry-detail copy for `'unavailable'` (verbatim): "Distillation happens through your connected assistant — see Settings → Connections." (renders as text + a link to `/more`... Connections lands in Task 6; link target `/more` until then, updated in Task 6.)
- [ ] Tests: provider-selection matrix (stub only when explicit; no_provider path writes error run, no proposal); distillStatus mapping. E2E untouched (dev keeps AI_PROVIDER=stub).
- [ ] Commit `Distill: honest unavailable state — stub only when explicit`.

### Task 3: Embeddings + retrieval (the one micro-API cost)

**Files:** Create `convex/ai/embed.ts` ("use node" action + embed provider w/ stub), `convex/lib/retrieval.ts` (pure), `convex/internal/embedStore.ts`; modify `convex/ai/models.ts` (`EMBED_MODEL='text-embedding-3-small'`, `EMBED_DIMENSIONS=1024`, `EMBED_VERSION='te3s-1024-v1'`), `convex/entries.ts` + `convex/ops/knowledgeWrites.ts` (schedule embed on create/edit/statement-change — via `ctx.scheduler` from mutations only), `convex/crons.ts` (create: backfill sweep where embeddingVersion ≠ current, batched), tests.

- [ ] `ai/embed.run({userId, targetType: 'entry'|'knowledge', targetId})` internalAction: load text (entry body / knowledge statement+body) → provider (stub: deterministic seeded-hash unit vector, 1024 dims; live: `client.embeddings.create({model, input, dimensions: 1024})`) → `embedStore.write` internalMutation patches `embedding` + `embeddingVersion` (ownership re-verified). aiRuns purpose `'embed'` start/finish with token usage. Failure = error run only; rows without embeddings are legal (fallback).
- [ ] `lib/retrieval.ts` (pure): `mergeRanked(vectorHits: {id, score}[], textHits: {id, rank}[], limit): {id, score}[]` — reciprocal-rank-fusion (k=60), dedupe, deterministic tiebreak by id; unit-test matrix incl. one-source-empty fallback.
- [ ] `convex/internal/search.ts` internalQuery `hybridKnowledge({userId, query, limit, ...filters})` + `hybridEntries(...)`: vector via `ctx.vectorSearch` (actions only — so: an internalAction `internal.ai.search.run` performs vectorSearch + calls internalQuery for text side... NOTE Convex vector search runs in actions; design: MCP tool handlers are already inside an httpAction ⇒ call `ctx.runAction(internal.ai.search...)`. Keep the seam: `internal/searchText.ts` internalQuery (search indexes) + vector part in the action; fuse with `mergeRanked`.)
- [ ] Backfill cron: hourly, processes ≤50 stale rows/user-agnostic batch (scan filtered; comment scale note).
- [ ] Tests: convex-test with stub embed — entry create schedules embed (assert embedding present after running scheduled fn via convex-test's scheduler support or direct action call), version stamping, retrieval fusion, missing-embedding text-only fallback.
- [ ] Commit `Embeddings (text-embedding-3-small @1024) + hybrid retrieval with deterministic dev stub`.

### Task 4: MCP server core — bearer path + tools

**Files:** Create `convex/http.ts` (httpAction router — NOTE: check-invariants.sh exempts http.ts by name), `convex/mcp/server.ts` (protocol: use `@modelcontextprotocol/sdk` Streamable HTTP in stateless JSON mode if it composes with Convex's Request/Response; else implement the JSON-RPC subset: initialize, tools/list, tools/call — document choice), `convex/mcp/tools.ts` (registry: name, description, inputSchema, scope, handler), `convex/mcp/auth.ts` (bearer resolution + rate limit), `convex/internal/mcpReads.ts` (userId-first internal queries powering read tools); modify `convex/internal/proposalStore.ts` (accept source 'mcp'), package.json (+`@modelcontextprotocol/sdk` if used).

- [ ] Auth (bearer half): parse `Authorization: Bearer atlas_sk_*` → SHA-256 → `apiKeys.by_hash` → not revoked → `{userId, scopes, keyId}`; 401 structured error otherwise. Rate limit: fixed-window 60/min per key — THIS task adds the two optional fields `rateWindowStart?: v.number()`, `rateWindowCount?: v.number()` to `apiKeys` in schema.ts (the one schema edit in this task; Task 5 adds the OAuth tables). 429 + Retry-After. `lastUsedAt` bump throttled 1/min.
- [ ] Tools per 06 §3 EXACTLY (names, args, result shapes as specced): read set (`atlas_search_knowledge` [hybrid via Task 3], `atlas_get_object`, `atlas_list_entries`, `atlas_get_entry`, `atlas_list_proposals`, `atlas_list_experiments`, `atlas_retrieve_context` [bundle, no synthesis]; `atlas_list_reviews`/`atlas_get_review` DEFERRED — no reviews exist; note in tool-list snapshot), capture (`atlas_create_entry` — ISO occurredAt parsed, source 'mcp'), propose (`atlas_preview_proposal` dry-run validateOps + post-filter warnings incl. near-duplicate check via vector when available; `atlas_submit_proposal` → upsertProposal source 'mcp', returns `{proposalId, opCount, reviewUrl}`). ProposalOp inputSchema imported from `PROPOSAL_OPS_JSON_SCHEMA`'s ops member (single source; propose tools accept the full six-kind runtime contract — reuse `proposalOpValidator` semantics via `validateOps`).
- [ ] Scope enforcement per tool before dispatch (`forbidden_scope`); every tool description states side effects; submit description carries the "user must approve" sentence verbatim (06 §3).
- [ ] MCP contract suite `tests/mcp-contract.test.ts` (node/vitest against the httpAction via convex-test's `t.fetch` if supported, else direct handler invocation): initialize/tools-list snapshot (pinned), per-tool happy shape, authz matrix (no key/revoked/wrong-scope), rate-limit 429, safety invariant (registry metadata: no tool touches knowledge tables directly — assert by inspecting the registry's declared writes + an adversarial submit that never materializes knowledge), cross-user isolation (key A cannot read user B).
- [ ] Commit `MCP server: Streamable HTTP endpoint, bearer auth, full tool registry + contract suite`.

### Task 5: API keys + OAuth 2.1 AS (schema additions live here)

**Files:** Modify `convex/schema.ts` (NEW tables only — apiKeys rate fields landed in Task 4: `oauthClients {clientId, name, redirectUris[], createdAt...}`, `oauthGrants {userId, clientId, codeHash?, codeExpiresAt?, codeChallenge?, accessTokenHash?, refreshTokenHash?, scopes[], revokedAt?}` — userId-led indexes); create `convex/apiKeys.ts` (public: create/list/revoke — requireUser, plaintext once), `convex/oauth.ts` (httpAction routes on http.ts: `/.well-known/oauth-authorization-server` RFC 8414, `/.well-known/oauth-protected-resource` RFC 9728, `/oauth/register` DCR RFC 7591 open-registration, `/oauth/token` code+PKCE exchange & refresh rotation), `app/(app)/oauth/authorize/page.tsx` (consent: Clerk-authed, shows client name + scopes, approve → internal mutation issues code → redirect with `?code=&state=`); MCP auth accepts `atlas_oat_` tokens (hash lookup in oauthGrants, scope check, revocation).
- [ ] Isolation rows for new public functions (apiKeys.create/list/revoke + the consent-issuing mutation); contract-suite additions: full OAuth dance simulated (register → authorize [test bypasses UI via internal issue with test user] → token → tools/call with the access token; PKCE mismatch rejected; reused code rejected; refresh rotates).
- [ ] Commit `OAuth 2.1 + DCR for ChatGPT connectors; API keys backend; rate-limit fields`.

### Task 6: Connections UI + Settings slice

**Files:** Create `app/(app)/connections/page.tsx`; modify `app/(app)/more/page.tsx` (Connections row live, links `/connections`), Task 2's unavailable-copy link target.
- [ ] Keys: create (named, shown ONCE with copy button + "you won't see this again"), list (name, prefix, lastUsed, created), revoke (confirm). Testids `key-create`, `key-name-input`, `key-plaintext`, `key-revoke-{i}`.
- [ ] Setup snippets (copyable code blocks): ChatGPT — Settings → Connectors (Developer mode) → paste `https://<prod>.convex.site/mcp` (OAuth flows automatically); Codex/agents — MCP config JSON with `Authorization: Bearer <key>` header. Honest note that ChatGPT uses OAuth (no key needed) while agents use a key.
- [ ] OAuth grants list on the same screen (client name, scopes, granted date, revoke) via a `oauthGrants.listMine`/`revokeMine` public pair (+isolation rows).
- [ ] E2E `e2e/connections.spec.ts` (@batch): create key → plaintext shown once → listed by prefix → revoke → gone. (OAuth dance not E2E'd — contract-suite covers it.)
- [ ] Commit `Connections: API keys UI, OAuth grants, client setup snippets`.

### Task 7: Ship — env split, deploy, live connector verification

**USER-BLOCKING inputs:** `OPENAI_API_KEY` (embeddings only now — tiny spend), and the user performing the ChatGPT connector + Codex connections on their devices for the gate walk.
- [ ] Final whole-branch review (SDD flow, full scale — this branch is large), fix wave, re-verify.
- [ ] PR → CI → merge → sync.
- [ ] Env split (finally): prod `frugal-orca-515` — `CLERK_JWT_ISSUER_DOMAIN`, `OPENAI_API_KEY`, `AI_DAILY_TOKEN_BUDGET=300000`, deploy; data export(dev)→import(prod); Vercel prod `NEXT_PUBLIC_CONVEX_URL` → frugal-orca; redeploy; smoke (+ `/mcp` initialize handshake added to scripts/smoke.sh per 11 §6). Dev: `AI_PROVIDER=stub` stays; no OpenAI key (embed stub note: dev embed uses stub via AI_PROVIDER).
- [ ] Backfill kick: run embed backfill once on prod for existing rows.
- [ ] Gate walk (user, guided): ChatGPT Developer-mode connector → OAuth consent in Atlas → capture an entry from ChatGPT → `atlas_retrieve_context` question → have it submit a proposal → approve in PWA → knowledge appears with provenance. Codex/Hermes: bearer key from Connections, same loop. LEDGER close-out.

## Deferred (re-slotted post-M)

In-app search/Ask UI (retrieval lib ready); connect pass; reviews (computed sections + on-demand prose); ops panel/issues/crashes; step-up auth for key creation; `atlas_list_reviews`/`atlas_get_review` tools (when reviews exist); Apps-SDK interactive widgets for ChatGPT.
