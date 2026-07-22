# Phase 3a — The AI Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entry → Distill → proposal in the review queue → op-level approve/edit/reject → `applyProposal` writes knowledge/evidence with full provenance in one transaction — with every AI run logged to `aiRuns`, a daily token budget with honest copy, graceful degradation when AI is unavailable, and a real dev/prod environment split.

**Architecture:** `ai/distill` is an internal Convex action (`"use node"`) that calls Claude (`claude-sonnet-5`, structured outputs via `output_config.format` json_schema) or the Phase 2 stub provider, post-filters the ops in code, and upserts ONE `proposals` row (idempotent by runId). `applyProposal` (in `proposals.resolve`) is the single writer for AI-originated mutations; it reuses the same ctx-level write helpers as the manual path (extracted in Task 2) so revision/provenance behavior is identical. Budget/aiRuns math is pure (`convex/lib/budget.ts`). Deferred to Phase 3b: Voyage embeddings + vector context/dedup (05 §5 tolerates missing embeddings — distill context uses recent knowledge until then), hybrid search, connect pass, ops panel, evals.

**Tech Stack:** `@anthropic-ai/sdk` (TS) in a Node Convex action · `claude-sonnet-5` (per spec 05 §2) with `output_config: {format: {type: 'json_schema', ...}}` and `effort: 'medium'` · existing `proposalOps` contract/validator · Playwright E2E against the stub provider.

## Global Constraints

- Branch `phase-3a-ai-loop`; PR to `main`; full pipeline + `test:e2e:batch` before ship.
- Every new PUBLIC Convex function: starts with `requireUser`/`currentUser`, no client `userId`, `assertOwner` after every `db.get`, and an isolation-registry row (registry-completeness enforces).
- **Proposal gate (invariant #2):** `proposals.resolve` is the ONLY code path materializing AI-originated ops. AI never writes confidence — no op sets it; recompute-from-evidence is the only writer.
- Every applied op touching knowledge/experiments writes a `revisions` row with `actor: 'ai-approved'`, the op's reason, and `proposalId` (invariant #3).
- Actions never write directly: all writes happen in mutations the action calls (`ctx.runMutation`); an action crash leaves only the `aiRuns` error row (05 §5).
- Claude calls: model ids ONLY from `convex/ai/models.ts`; prompt text ONLY from `convex/ai/prompts/` with a `PROMPT_VERSION` bump on any semantic change; no `temperature`/`top_p` (rejected on Sonnet 5); structured output validated by the SAME `validateOps` used at the mutation boundary; invalid → ONE retry with the validation error appended → then `aiRuns.error`, no proposal (05 §3).
- Honest copy verbatim where specified: budget message "AI budget reached for today — Distill will work tomorrow, your entry is saved"; empty result "Atlas found nothing worth proposing in this entry".
- Schema is UNCHANGED in this phase (all needed tables/fields exist). Deferred (logged, needs schema additions later): per-op reject reasons; capture-list distill-state dots.
- UI: MERIDIAN tokens only; inputs `text-base`; testids on every interactive element; pending proposals shown as a plain count on the Review tab (a number, not a red badge); contradiction pinning arrives with connect (3b).
- `bunx convex codegen` after new convex modules; commit regenerated `api.d.ts`; `bunx convex dev --once` before E2E.
- No `Date.now()` in `convex/lib/**`. Commits end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: AI constants — models, prompt v1, op JSON schema

**Files:**
- Create: `convex/ai/models.ts`, `convex/ai/prompts/distill.ts`
- Modify: `convex/shared/proposalOps.ts` (append schema export)
- Test: `tests/ai-contract.test.ts`

**Interfaces (Produces):**
- `models.ts`: `export const DISTILL_MODEL = 'claude-sonnet-5';` (spec 05 §2 — high-volume, structured, cost-sensitive) plus `export const DISTILL_EFFORT = 'medium' as const;`
- `prompts/distill.ts`: `export const DISTILL_PROMPT_VERSION = 'distill-v1';` and `export function buildDistillPrompt(input: { entryBody: string; entryKind: string; occurredAt: string; knowledgeContext: Array<{ id: string; type: string; statement: string; confidence: string }>; }): { system: string; user: string }` — the system prompt carries the conservatism contract (05 §1 distill): propose 0–4 ops; ONLY `createKnowledge` / `addEvidence` / `updateKnowledge` op kinds; prefer `addEvidence` on the provided existing knowledge over near-duplicate `createKnowledge`; never any confidence field; trivial/logistical entries ⇒ empty ops array (valid output); every op cites a short verbatim excerpt from the entry; statements first-person, ≤280 chars.
- `proposalOps.ts` gains `export const PROPOSAL_OPS_JSON_SCHEMA` — a JSON Schema object for `{ ops: ProposalOp[]; rationale: string; citations: Array<{ excerpt: string }> }` with `additionalProperties: false` everywhere, `anyOf` over the three distill op shapes, OpRef as `anyOf` of existing/new shapes. (Structured-outputs limits: no recursive schemas, no min/max constraints — keep it to types + enums + required; length limits stay enforced by `validateOps`/post-filters.)

- [ ] **Step 1 (TDD): `tests/ai-contract.test.ts`** — write first, watch it fail, then implement:

```ts
import { describe, expect, it } from 'vitest';
import { DISTILL_MODEL } from '../convex/ai/models';
import { DISTILL_PROMPT_VERSION, buildDistillPrompt } from '../convex/ai/prompts/distill';
import { PROPOSAL_OPS_JSON_SCHEMA, validateOps } from '../convex/shared/proposalOps';

describe('ai contract', () => {
  it('model id is the spec-mandated distillation model', () => {
    expect(DISTILL_MODEL).toBe('claude-sonnet-5');
  });
  it('prompt embeds the conservatism contract and the context', () => {
    const p = buildDistillPrompt({
      entryBody: 'Backed down again in the meeting.',
      entryKind: 'journal',
      occurredAt: '2026-07-22',
      knowledgeContext: [{ id: 'k1', type: 'insight', statement: 'I avoid conflict.', confidence: 'tentative' }],
    });
    for (const needle of ['0', '4', 'addEvidence', 'never', 'confidence', 'I avoid conflict.', 'Backed down again']) {
      expect(p.system + p.user).toContain(needle);
    }
    expect(p.system).toContain(DISTILL_PROMPT_VERSION);
  });
  it('schema-shaped outputs pass the runtime validator (single contract)', () => {
    const sample = {
      ops: [
        { op: 'createKnowledge', type: 'observation', statement: 'I noticed X.' },
        { op: 'addEvidence', knowledge: { kind: 'new', index: 0 }, sourceType: 'entry', sourceId: 'e1', stance: 'supports' },
        { op: 'addEvidence', knowledge: { kind: 'existing', id: 'k1' }, sourceType: 'entry', sourceId: 'e1', stance: 'contradicts', note: 'cuts against' },
      ],
      rationale: 'r',
      citations: [{ excerpt: 'Backed down' }],
    };
    expect(validateOps(sample.ops).every((v) => v.valid)).toBe(true);
    // Schema sanity: allowlisted op kinds only, closed objects
    const opSchemas = PROPOSAL_OPS_JSON_SCHEMA.properties.ops.items.anyOf as Array<{ properties: { op: { const: string } } }>;
    expect(opSchemas.map((s) => s.properties.op.const).sort()).toEqual(['addEvidence', 'createKnowledge', 'updateKnowledge']);
    expect(PROPOSAL_OPS_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});
```

- [ ] **Step 2: Implement.** `PROPOSAL_OPS_JSON_SCHEMA` (typed `as const` object; OpRef sub-schema `{anyOf: [{kind:'existing', id:string},{kind:'new', index:integer}]}`; every object `additionalProperties: false` + full `required` arrays). Prompt: system text states the contract in plain prescriptive language and interpolates `DISTILL_PROMPT_VERSION`; user text carries entry metadata/body and the numbered knowledge context (id + type + confidence + statement per line) with the instruction to reference existing knowledge by those exact ids.
- [ ] **Step 3:** `bunx convex codegen`; `bun run test` green; `bun run typecheck && bun run lint` clean.
- [ ] **Step 4: Commit** `Phase 3a: AI model/prompt constants + proposal-ops JSON schema`.

---

### Task 2: Domain write helpers (business logic exactly once)

Behavior-preserving refactor so the manual path and `applyProposal` share one implementation.

**Files:**
- Create: `convex/ops/knowledgeWrites.ts`
- Modify: `convex/knowledge.ts`, `convex/evidence.ts`
- Tests: existing suites must stay green UNCHANGED (that is the spec of this task); add `tests/knowledge-writes.test.ts` only for the new actor/proposalId parameter.

**Interfaces (Produces — exact signatures later tasks consume):**

```ts
// convex/ops/knowledgeWrites.ts — ctx-level shared write helpers (NOT pure lib; convex/lib stays pure)
export type WriteActor = { actor: 'user' | 'ai-approved'; proposalId?: Id<'proposals'> };

export async function insertKnowledge(ctx: MutationCtx, user: Doc<'users'>, args: { type: KnowledgeType; statement: string; body?: string; origin: 'user' | 'ai' }, who: WriteActor): Promise<Id<'knowledge'>>;           // validates statement, confidence 'hypothesis', rev 1 + revision 'Created'
export async function patchKnowledge(ctx: MutationCtx, user: Doc<'users'>, doc: Doc<'knowledge'>, patch: { statement?: string; body?: string; type?: KnowledgeType }, reason: string, who: WriteActor): Promise<void>;      // rev++, revision
export async function archiveKnowledgeDoc(ctx: MutationCtx, user: Doc<'users'>, doc: Doc<'knowledge'>, reason: string, who: WriteActor): Promise<void>;
export async function upsertEvidence(ctx: MutationCtx, user: Doc<'users'>, knowledge: Doc<'knowledge'>, args: { sourceType: 'entry' | 'outcome'; sourceId: string; stance: Stance; note?: string; origin: 'user' | 'ai' }, who: WriteActor): Promise<void>; // unique-triple upsert + recomputeConfidence (revision on label change uses who)
export async function insertRelationship(ctx, user, args: { fromId: Id<'knowledge'>; toId: Id<'knowledge'>; kind: RelationshipKind; note?: string; origin: 'user' | 'ai' }): Promise<void>; // both ends assertOwner'd by caller; dedupe on (from,to,kind)
export async function insertExperiment(ctx, user, args: { knowledgeId: Id<'knowledge'>; hypothesis: string; behavior: string; context: string; successCriteria: string; failureCriteria: string; observationTarget: string; origin: 'user' | 'ai' }, who: WriteActor): Promise<Id<'experiments'>>; // status 'draft', rev 1 + revision (targetType 'experiment')
```

- [ ] **Step 1:** Move the bodies from `knowledge.ts` (`writeRevision`, create/revise/archive internals) and `evidence.ts` (`recomputeConfidence`, add-upsert) into these helpers, parameterizing actor/proposalId/origin (existing public mutations pass `{actor:'user'}` and `origin:'user'` — byte-identical behavior). Public mutations keep their signatures and auth exactly as-is.
- [ ] **Step 2:** New test file: via convex-test, call the PUBLIC mutations and assert revision actor is still `'user'` everywhere (guard against accidental default flips). Full suite green with zero edits to existing test files — if an existing test needs editing, the refactor changed behavior: stop and fix.
- [ ] **Step 3:** `bunx convex codegen`; pipeline green. **Commit** `Phase 3a: extract shared knowledge-write helpers (one implementation for user + AI paths)`.

---

### Task 3: Application planning (pure) — dependency check + resolution merge

**Files:**
- Create: `convex/lib/applyPlan.ts`
- Test: `tests/applyPlan.test.ts`

**Interfaces (Produces):**

```ts
export type OpResolution = 'approved' | 'rejected' | 'edited';
export type PlanResult =
  | { ok: true; toApply: Array<{ index: number; op: ProposalOp }>; newIndexMap: Map<number, number> }
  | { ok: false; error: string; failedIndex: number };

/**
 * resolutions[i] applies to ops[i]; editedOps[i] (non-null only where resolutions[i]==='edited')
 * replaces the op and must already have passed validateOps. Refuses (AC-3.3) any approved/edited op
 * whose 'new'-OpRef targets a createKnowledge op that is rejected — with an error naming the dependency.
 * newIndexMap maps original createKnowledge op index -> position among APPLIED creations (so the
 * mutation can resolve {kind:'new'} refs to real ids at apply time).
 */
export function planApplication(ops: ProposalOp[], resolutions: OpResolution[], editedOps: Array<ProposalOp | null>): PlanResult;
```

- [ ] **Step 1 (TDD) `tests/applyPlan.test.ts`:** matrix — all approved; all rejected (ok, empty toApply); edited replaces op; approved addEvidence with `new`-ref to REJECTED createKnowledge ⇒ `{ok:false}` with error containing the dependency index (AC-3.3); `new`-ref to APPROVED creation resolves through `newIndexMap` even when an earlier creation was rejected (index shifting); length-mismatch inputs throw; edited-but-null editedOp ⇒ throw.
- [ ] **Step 2:** Implement (pure, no ctx). **Step 3:** suite green; commit `Phase 3a: pure application planning with dependency refusal`.

---

### Task 4: Proposals backend — the review queue's engine

**Files:**
- Create: `convex/proposals.ts`, `convex/internal/proposalStore.ts`
- Modify: `tests/isolation.registry.ts`
- Test: `tests/proposals.test.ts`

**Interfaces (Produces):**
- `internal/proposalStore.ts` (internalMutation, called by the distill action): `upsertProposal({ userId: Id<'users'>, source, runId, entryId, ops, rationale, citations, model, promptVersion }) → Id<'proposals'>` — validates ops with `validateOps` (throw on invalid — actions must never store junk), marks any existing PENDING proposal with the same `entryId` + source as `'superseded'` (AC-3.5), inserts `status:'pending'`, `opResolutions` all `'pending'`. Internal ⇒ explicit `userId` first param (08 §2), no isolation row needed.
- `proposals.list({})` → pending proposals for the user, newest first, each: `{_id, source, rationale, entryId, entryExcerpt (from entry body, 140 chars), citations, ops, opResolutions, _creationTime}`.
- `proposals.forEntry({entryId})` → the newest non-superseded proposal for that entry or null (`{_id, status}`) — powers the entry-detail Distill button state.
- `proposals.pendingCount({})` → number (uses `currentUser`; 0 when signed out/unprovisioned — safe for the nav).
- `proposals.resolve({ id, resolutions: ('approved'|'rejected'|'edited')[], editedOps: (ProposalOp-shaped | null)[] })` → applies in ONE mutation: `assertOwner` proposal; must be `'pending'`; validate editedOps via `validateOps`; `planApplication(...)`; `{ok:false}` ⇒ `ConvexError({code:'dependency', message})`; apply `toApply` in order via Task 2 helpers with `who = {actor:'ai-approved', proposalId: id}` and `origin:'ai'` — `createKnowledge`→`insertKnowledge`, `addEvidence`→resolve OpRef (existing id `assertOwner`'d via `normalizeId`; `new` via `newIndexMap`) then `upsertEvidence` (verify entry-type sourceId exists + owned before writing — 04 §notes), `updateKnowledge`→`patchKnowledge` (reason from op), `archiveKnowledge`→`archiveKnowledgeDoc`, `createRelationship`→both ends resolved+owned→`insertRelationship`, `createExperiment`→`insertExperiment`; finally patch proposal `{status:'resolved', opResolutions, resolvedAt: Date.now()}`.

- [ ] **Step 1 (TDD) `tests/proposals.test.ts`** (convex-test; seed via `internal.internal.proposalStore.upsertProposal`): approve-all creates knowledge with `origin:'ai'`, revision `actor:'ai-approved'` + proposalId (AC-3.2); reject-all writes nothing but records resolutions + resolved status; mixed approve/edit/reject applies exactly the approved/edited subset in one call; dependency refusal surfaces the ConvexError and leaves the proposal pending (AC-3.3); addEvidence on `new`-ref recomputes confidence (hypothesis→tentative) with a revision; re-upsert same runId/entry supersedes the pending proposal, list shows only the new one (AC-3.5); resolve on non-pending throws; `forEntry` returns the newest proposal; `pendingCount` counts only pending.
- [ ] **Step 2:** Implement. **Step 3:** isolation rows for `proposals.list` (B sees []), `proposals.forEntry` (B with A's entryId → not_found), `proposals.pendingCount` (B → 0 while A has pending), `proposals.resolve` (B with A's proposal id → throws) — copy the established registry pattern; seed via the internal upsert with A's userId.
- [ ] **Step 4:** codegen; pipeline green; commit `Phase 3a: proposals backend — idempotent upsert, op-level resolve, single-writer apply`.

---

### Task 5: Budget + aiRuns plumbing

**Files:**
- Create: `convex/lib/budget.ts`, `convex/internal/aiRuns.ts`
- Test: `tests/budget.test.ts` (pure lib) + cases appended in `tests/proposals.test.ts`? No — create `tests/airuns.test.ts` (convex-test).

**Interfaces (Produces):**
- `lib/budget.ts` (pure): `dayWindow(nowMs: number): { start: number; end: number }` (UTC day — dev simplicity; per-user tz is a 3b refinement, note in code) and `withinBudget(spentTokens: number, budget: number): boolean`.
- `internal/aiRuns.ts` internal mutations/queries: `start({userId, purpose, runId, model, promptVersion}) → Id<'aiRuns'>` (status `'running'`; idempotent: an existing row with same runId is patched back to running); `finish({id, status: 'ok'|'error', inputTokens?, outputTokens?, error?, proposalId?})`; `spentToday({userId, nowMs}) → number` (sums input+output tokens of non-error runs in the window via full scan filtered by userId — test-scale fine, index later); `budgetFor(env)` helper in the action reads `process.env.AI_DAILY_TOKEN_BUDGET` (default 50000).
- [ ] **Steps (TDD):** budget lib matrix (window boundaries, zero budget); aiRuns start/finish/spentToday via convex-test incl. runId idempotence. Implement; codegen; pipeline green; commit `Phase 3a: aiRuns ledger + daily token budget (pure math + internal plumbing)`.

---

### Task 6: `ai/distill` action + public trigger

**Files:**
- Create: `convex/ai/distill.ts` (`"use node"`), `convex/internal/distillInputs.ts`
- Modify: `convex/entries.ts` (add `requestDistill`), `convex/ai/provider.ts` (extend stub), `tests/isolation.registry.ts`, `package.json` (add `@anthropic-ai/sdk`)
- Test: `tests/distill.test.ts`

**Interfaces:**
- `internal/distillInputs.ts` internalQuery `load({userId, entryId})` → `{ entry: {body, kind, occurredAt}, knowledgeContext: top 12 ACTIVE knowledge by most-recent revision (pre-embedding fallback — 3b upgrades to vector-nearest), spentToday, user settings }`.
- `entries.requestDistill({id})` public mutation: `requireUser` + `assertOwner`; schedules `internal.ai.distill.run({userId, entryId})` via `ctx.scheduler.runAfter(0, ...)`; returns `{scheduled: true}`. (Budget refusal happens in the action so the message is honest even under races; UI reads state reactively via `proposals.forEntry` + latest aiRun state — expose `aiRuns` outcome through `proposals.forEntry`'s null + a new tiny public query `entries.distillStatus({id})` → `'none'|'running'|'proposed'|'empty'|'error'|'budget'` derived from newest aiRun with runId prefix `distill:{entryId}:` + proposal existence. Add isolation row.)
- `ai/distill.run` internalAction: load inputs → budget check (`withinBudget(spent, env budget)`; over ⇒ aiRuns start+finish `error` with `error:'budget'` and STOP — no Claude call) → aiRuns `start` (runId `distill:{entryId}:{DISTILL_PROMPT_VERSION}`) → provider:
  - stub (`getProviderKind(process.env)==='stub'` OR no `ANTHROPIC_API_KEY`): `stubDistillation(entry.body)` (extend the stub to also return `citations: [{excerpt: body.slice(0, 60)}]`).
  - live: `new Anthropic()` → `client.messages.create({ model: DISTILL_MODEL, max_tokens: 2048, output_config: { effort: DISTILL_EFFORT, format: { type: 'json_schema', schema: PROPOSAL_OPS_JSON_SCHEMA } }, system, messages: [{role:'user', content: user}] })`; parse `JSON.parse(text block)`; `validateOps` fail ⇒ ONE retry with the verdict errors appended to the user message; fail again ⇒ finish `error`, no proposal (05 §3). Record `usage.input_tokens/output_tokens` on finish.
  - post-filters (code, not prompt-trust — 05 §3): ≤4 ops (truncate = reject run as error, don't trim silently); only the three allowed op kinds; every `addEvidence.sourceId` must equal THIS entry's id (rewrite `sourceId` to the real entry id when the model echoes a placeholder; anything else ⇒ drop that op and its dependents via a rejected-resolution plan check); `kind:'existing'` refs must resolve+own (via the internal query's context ids) else drop.
  - empty ops after filtering ⇒ finish `ok` with NO proposal (AC-3.1's "nothing worth proposing").
  - else `upsertProposal` then finish `ok` with `proposalId`.
- [ ] **Steps:** TDD via convex-test with stub env (`process.env.AI_PROVIDER='stub'` set in the test file before importing modules; convex-test runs actions): requestDistill→run produces a pending proposal with citations + an ok aiRun; second distill supersedes (AC-3.5); budget 0 ⇒ no proposal + error aiRun `'budget'` + `distillStatus` returns `'budget'` (AC-3.4); trivial-empty path (stub extension: body 'skip' ⇒ empty ops) ⇒ status `'empty'`. Isolation rows: `entries.requestDistill` (B on A's entry throws), `entries.distillStatus` (B on A's entry throws). `bun add @anthropic-ai/sdk`. Codegen; pipeline green; commit `Phase 3a: distill action — budget-gated, structured-output, post-filtered, idempotent`.

---

### Task 7: Review queue UI + nav count + Distill button

**Files:**
- Modify: `app/(app)/review/page.tsx` (replace placeholder), `components/bottom-nav.tsx` (count), `app/(app)/entries/[id]/page.tsx` (Distill action + states)
- Create: `components/op-card.tsx`

**Interfaces / requirements (complete code is the implementer's to write from these binding specs — the backend shapes above are exact):**
- **Review page** (`review-*` testids): `useQuery(api.proposals.list)`; group by proposal; header per proposal: source + entryExcerpt (links `/entries/{entryId}`) + rationale line with the "AI" origin mark (10 §4). Each op renders as an `OpCard`: type chip (`createKnowledge` → knowledge type; `addEvidence` → stance-colored chip), proposed statement/change in `font-statement`, cited excerpt (from citations, tappable → entry), and per-op controls **Approve · Edit · Reject** (`op-approve`/`op-edit`/`op-reject` + index suffix). Edit opens inline statement/body inputs (`text-base`) and stores an edited op (client keeps a `(ProposalOp|null)[]` mirror). Footer: **Approve remaining** (`proposal-approve-remaining`) sets all still-pending to approved, then **Apply** (`proposal-apply`) calls `proposals.resolve` with the resolution arrays; dependency ConvexError renders inline naming the dependency (AC-3.3 copy from the error message); success removes the proposal reactively. Empty state verbatim: "Nothing awaits review. Capture something, or ask Atlas a question."
- **Nav count:** `bottom-nav.tsx` renders the pending count after "Review" as plain text `· N` when N>0 (`nav-review-count`), via `useQuery(api.proposals.pendingCount, {})` guarded by `useConvexAuth().isAuthenticated` (skip otherwise). A number, not a badge — no color, no pill.
- **Entry detail:** a Distill button (`entry-distill`) driven by `useQuery(api.entries.distillStatus)`: `'none'|'error'` → "Distill" (calls `requestDistill`); `'running'` → disabled "Distilling…"; `'proposed'` → link "Distilled ✓ — view proposal" → `/review`; `'empty'` → text "Atlas found nothing worth proposing in this entry" + re-Distill affordance; `'budget'` → text verbatim "AI budget reached for today — Distill will work tomorrow, your entry is saved". Unavailable state (action throws / no provider): plain "Distill is unavailable right now" — capture/browse unaffected (05 §5).
- [ ] **Steps:** implement; `bun run typecheck && bun run lint && bun run test` clean; commit `Phase 3a: review queue with op-level triage, nav count, Distill states`.

---

### Task 8: E2E — the AI loop against the stub

**Files:**
- Create: `e2e/ai-loop.spec.ts`
- Pre-req (one-time env): `bunx convex env set AI_PROVIDER stub` and `bunx convex env set AI_DAILY_TOKEN_BUDGET 50000` on the DEV deployment (idempotent; document in the report).

**Binding requirements:** `@batch` tagged; beforeEach ensure+preclean+signInAs (user a); testid-only. Test 1 (the loop, AC-3.1/3.2): capture entry → open it → `entry-distill` → wait for "Distilled ✓" state → nav-review shows count `· 1` → review page shows the stub's op card → Approve remaining → Apply → knowledge list contains the stub statement → its detail History shows "AI-proposed, you approved". Test 2 (reject leaves no trace): capture → distill → reject the op → Apply → knowledge list empty state still shown, review queue empty. Run the FULL batch (`bun run test:e2e:batch`) twice consecutively — including Phase 2 suites.
- [ ] **Steps:** set dev env vars; `bunx convex dev --once`; write spec; batch green ×2; commit `Phase 3a E2E: distill → review → approve/reject loop (stub provider)`.

---

### Task 9: Ship — env split, prod deploy, live smoke, ledger

**This task has a USER-BLOCKING input: the `ANTHROPIC_API_KEY` for the prod deployment.** Everything before it is stub-safe.

- [ ] **Step 1:** Final whole-branch review (SDD flow), fixes, pipeline + full E2E batch green.
- [ ] **Step 2:** Push, PR, CI green, merge, sync main.
- [ ] **Step 3 — environment split (fixes the Phase-1 open infra note):**
  - Prod deployment `frugal-orca-515`: `bunx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://settling-dassie-70.clerk.accounts.dev` (same Clerk dev instance — accepted risk, already registered), `--prod ANTHROPIC_API_KEY <from user>`, `--prod AI_DAILY_TOKEN_BUDGET 300000`; `bunx convex deploy -y`.
  - Data migration: `bunx convex export --path /tmp/atlas-dev-export.zip` (dev) → `bunx convex import --prod /tmp/atlas-dev-export.zip` (owner's entries/knowledge move to prod).
  - Vercel PRODUCTION env only: update `NEXT_PUBLIC_CONVEX_URL` → `https://frugal-orca-515.convex.cloud` (preview stays on dev); trigger redeploy; smoke.
  - Dev stays: `AI_PROVIDER=stub`, low budget — E2E target forever.
- [ ] **Step 4:** Live-AI smoke: owner phone (or browser) — distill one real entry on prod, verify a real proposal appears and approve it; check `aiRuns` row has token counts (dashboard). Graceful-degradation spot check: capture still works.
- [ ] **Step 5:** `LEDGER.md` line + `.superpowers/sdd/progress.md` close-out. Phase 3a gate: entry → distill → review → approved knowledge with provenance, on the phone, with budget + failure honesty.

---

## Deferred (Phase 3b, logged)

Voyage embeddings + vector indexes + backfill cron; distill context upgraded to vector-nearest + cosine-0.95 dedup post-filter; hybrid search UI; `ai/connect` v1 + contradiction pinning in the queue; owner ops panel + issue inbox + crash reporting; evals fixture set + `bun run eval` + `docs/evals/LOG.md`; per-op reject reasons (schema addition); capture-list distill-state dots; per-user-timezone budget windows; auto-distill setting wiring (`settings.autoDistill` exists, default off — trigger stays manual in 3a).
