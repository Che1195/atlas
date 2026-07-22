# 06 — MCP Interface

Atlas exposes one MCP server over Streamable HTTP at `https://<convex-deployment>.convex.site/mcp`, implemented as a Convex `httpAction` using the MCP TypeScript SDK. It is the *only* external programmatic surface (no parallel REST API in MVP). An MCP client — the ChatGPT app (via its connector), Codex CLI, or any other MCP-capable agent — **is** Hermes (07-hermes).

## 1. Authentication & scoping

Two auth modes resolve to the same `{userId, scopes}` model and the same tool registry — no client gets a different Atlas.

- **Bearer key** (header-capable agents: Codex CLI, other MCP agents): `Authorization: Bearer atlas_sk_<40 hex>`. Keys are created in Settings → Connections, shown once, stored as SHA-256 hash (`apiKeys` table), revocable, per-client-named.
- **OAuth 2.1 + Dynamic Client Registration** (connector-only clients: ChatGPT, which mandates OAuth and does not accept bearer tokens — ADR-0012): Atlas runs an authorization server exposing `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource` (RFC 9728) metadata, open Dynamic Client Registration (`/oauth/register`, RFC 7591), and an `/oauth/authorize` consent screen (Clerk-authed, shows client name + requested scopes) → `/oauth/token` code exchange with mandatory PKCE (S256). Access tokens (`atlas_oat_<40 hex>`) are hashed the same way as bearer keys; refresh tokens rotate on use; authorization codes are single-use with a ≤60s TTL.
- Key/token → user resolution on every request; all downstream calls execute with that user's id through the same domain functions as the app. A leaked key or token exposes only that user's data and only within its scopes.
- Scopes: `read` (search/get/list), `capture` (create entries), `propose` (submit proposals). Default key = all three; a read-only key is one toggle. OAuth grants carry the same scope set, chosen at consent time.
- Rate limit: 60 requests/min per key or access token, enforced in the httpAction (fixed-window counter); 429 with `Retry-After`.

## 2. Design rules (agent-facing surface)

- **Write asymmetry is the product's safety model:** `capture` writes entries directly (raw evidence, clearly provenance-marked `source: 'mcp'`); *all* knowledge mutation goes through `atlas_submit_proposal` and lands in the user's review queue. There is no tool that mutates knowledge directly — not for any scope.
- Tool results return compact JSON with stable ids; verbose prose lives in the client LLM, not the payload.
- Every tool description states its side effects explicitly; read tools state "read-only".
- Errors are structured: `{ code: 'not_found' | 'forbidden_scope' | 'invalid_ops' | 'budget_exceeded' | 'rate_limited', message, details? }`.

## 3. Tools

### Read (`read` scope)

**`atlas_search_knowledge`** — `{ query: string, types?: KnowledgeType[], confidence?: Confidence[], status?: 'active'|'archived', limit?: number≤25 }` → ranked `[{ id, type, statement, confidence, status, evidenceCounts: {supports, contradicts}, updatedAt }]`. Hybrid vector+text search.

**`atlas_get_object`** — `{ id }` → full knowledge object: statement, body, confidence (+ computed suggestion inputs S/C), origin, evidence rows (with source excerpts), relationships (both directions), revision summaries (rev, actor, reason, date), linked experiments.

**`atlas_list_entries`** / **`atlas_get_entry`** — `{ from?, to?, kind?, limit? }` → entry metadata; get returns full body plus evidence rows citing it (which knowledge this entry supports/contradicts).

**`atlas_list_proposals`** — `{ status?: 'pending'|'resolved'|'expired'|'superseded', limit? }` → proposals with per-op resolutions. This is how Hermes learns what the user accepted/rejected — the feedback channel that makes proposing better over time.

**`atlas_list_experiments`** — `{ status? }` → experiments with tested-object statement and latest outcome.

**`atlas_list_reviews`** / **`atlas_get_review`** — generated reviews (structured sections + prose). These ship once reviews exist (12-roadmap Phase 6) — deferred out of the initial tool set, which has no reviews to serve.

**`atlas_retrieve_context`** — `{ question: string, limit?: number≤20 }` → the Ask retrieval bundle: `{ knowledge: [...], entries: [{ id, excerpt }], relationships: [...] }` ranked by relevance, **no synthesis**. The calling assistant reasons over it itself; Atlas doesn't spend tokens generating an answer another LLM will re-generate.

### Capture (`capture` scope)

**`atlas_create_entry`** — `{ kind: 'journal'|'conversation'|'note', title?, body, occurredAt? (ISO), duplicateOf? }` → `{ id }`. Direct write, `source: 'mcp'` (ADR-0009). Description instructs clients: capture the user's words faithfully; do not editorialize; use `duplicateOf` when re-telling a known event.

### Propose (`propose` scope)

**`atlas_preview_proposal`** — `{ ops: ProposalOp[], rationale, citations }` → dry-run: runs the full op validator + post-filters (05 §3) and returns per-op verdicts `{ valid, error?, warnings? (e.g. near-duplicate of knowledge kn_x) }` **without writing**. Lets Hermes fix problems before submitting.

**`atlas_submit_proposal`** — same input (+ optional `entryId` linkage) → validates identically, writes a `proposals` row with `source: 'mcp'`, status `pending` → `{ proposalId, opCount, reviewUrl }`. Never auto-applies. The tool description states plainly: "The user must approve these changes in Atlas before they take effect."

`ProposalOp` JSON Schema is generated from `convex/shared/proposalOps.ts` (single source of truth) and embedded in the tool's inputSchema, so schema drift between app and MCP is impossible.

## 4. Server implementation notes

- One `httpAction` route (`/mcp`) handling the Streamable HTTP protocol; stateless JSON mode (no SSE session state) — every call authenticates the bearer key fresh. Convex actions are stateless per-request, which matches.
- Tool handlers call the same internal functions as the PWA (`internal.knowledge.searchForUser`, etc.) with the resolved `userId` — the httpAction layer contains auth, rate limiting, and shape translation only (invariant #4).
- `lastUsedAt` bumped per call (throttled to 1/min) for the Connections screen.
- Protocol conformance + authz tested by the MCP contract suite (11-testing §4).

## 5. Explicit non-goals (MVP)

- No resources/prompts surface (tools only — every current client speaks tools; revisit when Hermes-in-app lands).
- No streaming tool results, no sampling, no elicitation.
- No admin/multi-user tools; a key can never see another user's data by construction.
