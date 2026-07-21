# 11 — Testing Strategy

Playbook Phase 2 discipline, built after ~3 features, not ~20. Five layers, cheapest first. Runner: Vitest (unit + convex-test), Playwright (E2E + MCP contract). All commands via bun scripts.

## 1. Pure-logic unit tests (`convex/lib/**` — the bulk)

Everything meaningful lives in pure modules with injected time (no `Date.now()` inside — playbook), so it tests for free:

- `confidence.ts`: full matrix of the S/C computation (03 §5) — dedup through `duplicateOf` chains, outcome double-weighting, override-drift, boundary counts.
- `proposalOps.ts`: op validation (statement length, ref ranges, unknown fields rejected — this is the allowlist pattern's home), dependency analysis (approving op referencing rejected `new`-ref fails), application planning (ops → concrete writes + revision list).
- `dedup.ts`: near-duplicate statement detection thresholds.
- `retrieval.ts`: vector/text result merging and ranking, missing-embedding fallback.
- `reviewSections.ts`: period delta computation from revision/proposal fixtures — confidence transitions, zero-delta skip rule.

Every bug fixed anywhere gets a regression test here first if the logic is reachable purely.

## 2. Convex function tests (`convex-test`)

In-memory Convex runtime, real schema, mocked identity. Two suites:

**Behavioral:** each public function's happy path + validation failures; `applyProposal` transactional behavior (approved subset applies atomically; revision rows written; dependency rejection); entry-with-evidence archives instead of deleting; `ensureUser` idempotency.

**Adversarial isolation (the suite that gates Phase 1):** for *every* public function, run as user B against user A's data — expect throw/empty, never content. Table-driven so adding a function without adding its isolation row fails the suite (registry check compares exported functions against the test table). This is the playbook's rules-verification, translated to Convex.

## 3. E2E (Playwright, against dev Convex)

- Boots `next dev` + `convex dev` against the dev deployment; Clerk test-mode users; pre-clean is idempotent by test-user id (playbook: prior failed runs leave state).
- Selectors: `data-testid` only. Screenshot on failure. Helpers expand collapsed sections before asserting; blur before click (keyboard-hides-chrome lesson).
- Core suites: **auth+onboarding** (signup with display name → capture empty state), **capture-loop** (entry → distill [AI stubbed, §5] → review queue → approve/edit/reject ops → knowledge list + detail shows evidence/revision), **experiment-loop** (create from object → outcome → evidence proposal → approve → confidence label updates), **search-ask** (stubbed synthesis, citation links resolve), **settings** (key create/revoke, export downloads valid JSON, issue filing).
- AI stubbing: dev-only env flag routes `ai/*` actions to a fixture provider returning canned structured outputs — E2E tests the *loop*, not the model. One separate `@live-ai` tagged smoke (single distill on dev budget) run manually before releases.
- Cadence: one E2E pass per feature batch (playbook), full suite in the pre-deploy pipeline.

## 4. MCP contract tests

Playwright-adjacent node suite using the MCP TS SDK client against a dev deployment:
- Handshake/protocol conformance; tool list matches 06 §3 exactly (snapshot).
- Per tool: valid call shape → result schema assertion (zod mirrors of documented outputs).
- AuthZ: missing key, revoked key, wrong-scope per tool (read key calling `atlas_submit_proposal` → `forbidden_scope`), rate-limit 429 behavior.
- Safety invariants as tests: no tool in the registry mutates `knowledge`/`evidence`/`relationships` tables directly (registry metadata assertion); `atlas_submit_proposal` result row is `pending`.
- Proposal schema drift guard: JSON Schema embedded in the tool is generated from `proposalOps.ts` in the build — test asserts generation is current (fails if someone edits one side).

## 5. AI evals (05 §6)

Fixture entries → live model → shape assertions (op-count bounds, no-proposal-on-trivial, evidence-over-duplicate, never-a-confidence-field) + review tone check (banned-lexicon + LLM-judge rubric). Manual `bun run eval` per prompt-version bump; logged in `docs/evals/LOG.md`; a prompt version may not ship without a logged run. Not in CI (cost, nondeterminism).

## 6. Pipeline (every ship, no exceptions)

```
bun run typecheck && bun run lint && bun run test        # unit + convex-test
bun run test:e2e -- --grep @batch                        # relevant tagged e2e
git commit && git push
npx convex deploy && vercel --prod                       # or push-triggered
bun run smoke                                            # curl prod URL + /mcp initialize handshake
echo "$(date +%F) <what shipped>" >> LEDGER.md           # git-ignored recovery map
```

CI (GitHub Actions when the repo goes remote): typecheck + lint + unit + convex-test on every push; E2E nightly + pre-release. The four-audit review (12-roadmap gate) is a process step, not a test suite — but its findings land here as regression tests.
