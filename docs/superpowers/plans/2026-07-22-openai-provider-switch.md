# OpenAI Provider Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Replace Anthropic (Claude + Voyage, ADR-0008) with OpenAI as Atlas's AI provider — a user decision (2026-07-22) superseding the locked stack choice — via a new ADR, spec updates, and a swap of the distill action's live branch. Everything else (proposal gate, review queue, budget, stub provider, all invariants) is provider-agnostic and unchanged.

**Facts (researched 2026-07-22):** GPT-5.6 family (released 2026-07-09): `gpt-5.6-sol` $5/$30 per MTok (flagship), `gpt-5.6-terra` $2.50/$15 (balanced), `gpt-5.6-luna` $1/$6 (fast). Responses API preferred; structured outputs via `text: {format: {type:'json_schema', name, schema, strict:true}}`; read `response.output_text`; truncation = `response.status === 'incomplete'` with `incomplete_details.reason === 'max_output_tokens'`; refusal surfaces as a refusal item in output. Strict mode requires `additionalProperties:false` + all-fields-required (our schema's required-but-nullable shape is exactly this; null-stripping already implemented). Embeddings (Phase 3b): `text-embedding-3-*` supports `dimensions: 1024` → locked schema vector dims survive; verify exact model at 3b time.

## Global Constraints

- Branch `openai-provider-switch`; pipeline + full E2E batch before ship; commits end with the standard Co-Authored-By line.
- Model ids ONLY in `convex/ai/models.ts`. Distillation: `gpt-5.6-terra` (maps sonnet-5's "high-volume, structured, cost-sensitive" slot). Future rows (3b+): weekly reviews `gpt-5.6-sol`, daily reviews + connect + ask `gpt-5.6-terra` — spec table only, no code yet.
- Env var: `OPENAI_API_KEY` (replaces ANTHROPIC_API_KEY everywhere incl. stub-fallback detection). Stub behavior unchanged.
- The distill action keeps ALL existing semantics: budget gate, aiRuns ledger, runId idempotence, ≤2 provider calls, null-strip → validateOps, post-filters, truncation/refusal handling, exactly-one-finish. Only the provider client changes.
- No prompt text changes (PROMPT_VERSION stays `distill-v1`; per spec 05 §2 a model change is a one-line change recorded per-run in aiRuns).

---

### Task 1: ADR-0011 + spec updates (docs only)

**Files:** Create `docs/spec/adr/0011-openai-provider.md`; modify `docs/spec/00-overview.md` (locked-stack bullet), `docs/spec/02-architecture.md` (provider boxes/§3 env vars/§piece-responsibilities AI-provider paragraph), `docs/spec/05-ai-pipeline.md` (§2 models table), `docs/spec/08-security-model.md` (AI-provider data-handling row), `CLAUDE.md` (stack line).

- [ ] ADR-0011: status Accepted, supersedes ADR-0008 (mark 0008 Superseded with a pointer). Content: user decision 2026-07-22; what changes (provider client in ai/distill, env key, 3b embedding pairing text-embedding-3 @1024 dims — schema unchanged); what deliberately does NOT change (proposal gate, structured-output discipline, budget, prompts, stub); model mapping table with the pricing facts above; risks (single-provider coupling unchanged in shape; OpenAI API data not used for training by default — cite platform policy).
- [ ] 05 §2 table: distill/connect/ask → `gpt-5.6-terra`; reviews (weekly) → `gpt-5.6-sol`; reviews (daily) → `gpt-5.6-terra`; embeddings → `text-embedding-3-small (dimensions: 1024)` with a "verify current model at 3b" note. Keep the "centralized in convex/ai/models.ts" paragraph.
- [ ] 00/02/08/CLAUDE.md: replace Claude/Voyage/Anthropic references in the stack/architecture/threat rows (02's diagram boxes: "OpenAI API (generation)" / "OpenAI API (embeddings)"; env var rename). Do NOT touch historical deviation notes (09 §2 Clerk notes etc.).
- [ ] Commit: `ADR-0011: switch AI provider to OpenAI (supersedes ADR-0008)`.

---

### Task 2: Code swap — distill live branch + tests

**Files:** Modify `convex/ai/models.ts`, `convex/ai/distill.ts`, `package.json` (+`openai`, −`@anthropic-ai/sdk`), `tests/ai-contract.test.ts`, `tests/distill.test.ts` (mocked-SDK sections only); NO other files.

- [ ] `models.ts`: `DISTILL_MODEL = 'gpt-5.6-terra'`; replace `DISTILL_EFFORT` with `DISTILL_REASONING_EFFORT = 'medium' as const` (wire only if the SDK's Responses API types accept `reasoning: {effort}` for this model — otherwise omit the param and delete the constant; document which in the report).
- [ ] `distill.ts` live branch: `import OpenAI from 'openai'`; client `new OpenAI()` (reads OPENAI_API_KEY); call:
  ```ts
  const response = await client.responses.create({
    model: DISTILL_MODEL,
    max_output_tokens: 8192,
    text: { format: { type: 'json_schema', name: 'distill_ops', schema: PROPOSAL_OPS_JSON_SCHEMA, strict: true } },
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  ```
  (Verify exact SDK field names against the installed `openai` package types — `input` message shape and usage fields; adjust minimally if types differ, documenting deltas.) Truncation: `response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens'` → existing 'truncated' path (same bounded same-prompt retry). Refusal: detect a refusal output item → existing 'refusal' path. Parse `response.output_text` → existing null-strip → validateOps flow (validation-retry unchanged). Tokens: `response.usage.input_tokens/output_tokens` (verify names in types) summed across attempts. Key-fallback: stub when `getProviderKind(...)==='stub'` OR `!process.env.OPENAI_API_KEY`.
- [ ] Tests: update the mocked-SDK distill tests to mock `openai` (same scenarios: clean, truncated-partial-JSON retry + ≤2-call bound, refusal, invalid→validation-retry, request-shape assertion incl. model + strict json_schema + no ANTHROPIC references). `ai-contract.test.ts`: model id expectation → `gpt-5.6-terra`.
- [ ] `bun remove @anthropic-ai/sdk && bun add openai`; grep the repo for remaining `anthropic`/`ANTHROPIC` outside docs/history — must be zero in code.
- [ ] Full `bun run pipeline` green; `bunx convex dev --once`; `bun run test:e2e:batch` green (stub path unaffected — proves no regression).
- [ ] Commit: `Switch distill live provider to OpenAI Responses API (gpt-5.6-terra)`.

---

### Task 3: Ship — PR, env split, live smoke (USER-BLOCKING: OPENAI_API_KEY)

- [ ] Final review (SDD flow, scaled — the diff is small), PR, CI green, merge, sync.
- [ ] Env split per the Phase 3a plan Task 9, with the key swap: prod `frugal-orca-515` gets `CLERK_JWT_ISSUER_DOMAIN`, `OPENAI_API_KEY` (from user), `AI_DAILY_TOKEN_BUDGET=300000`; `bunx convex deploy -y`; data `export`(dev)→`import --prod`; Vercel PRODUCTION `NEXT_PUBLIC_CONVEX_URL` → `https://frugal-orca-515.convex.cloud`; redeploy; smoke. Dev keeps `AI_PROVIDER=stub` + 50k budget.
- [ ] Live smoke: real entry distilled on prod via gpt-5.6-terra; proposal quality sanity; aiRuns tokens recorded; budget visible. Graceful-degradation spot check.
- [ ] LEDGER.md + progress ledger close-out. Phase 3a gate closes here.
