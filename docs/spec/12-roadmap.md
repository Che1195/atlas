# 12 — Implementation Roadmap

Playbook-adapted: phases with hard gates, capture surfaces earliest (the moat is accumulated personal data), verification harness before the feature avalanche, hardening as one deliberate pass, four-audit before any non-owner user. Firebase-flavored playbook items are mapped to this stack (Convex gives two-DBs and schema-enforcement natively; "rules" work becomes the isolation suite).

Each phase ends at the full pipeline (11 §6). Week counts assume one developer + AI agents, part-time; treat as sequence, not calendar promises.

## Phase 0 — Foundations (wk 1) · *no feature code before these*

- Repo init; Next.js + Tailwind v4 + Convex + Clerk scaffolding; bun scripts for the pipeline; `LEDGER.md` started.
- **Full schema v1 committed** (04) — all tables including `issues`/`crashes`/`aiRuns`, even though their features come later. Schema-first is this stack's data-model-on-paper.
- `convex/shared/proposalOps.ts` (types + runtime checker) — the contract everything else imports.
- `requireUser` + subject-scoping header comment + lint rule (08 §2).
- MERIDIAN tokens in `@theme` before the second component (10 §1). Light + dark.
- Dev/prod Convex deployments; dev/prod Clerk instances; env var layout; Vercel project.
- Display name at signup; `ensureUser`; timezone capture.

**Gate:** pipeline runs end-to-end on a hello-world page (typecheck→lint→test→deploy→smoke→ledger); a second signup cannot see the first user's (empty) data — isolation suite skeleton passes.

## Phase 1 — Walking skeleton (wk 1–2)

Auth → **capture entry → manually create knowledge → link evidence by hand → see it in Knowledge list/detail** → deploy, installed as PWA on the owner's phone. No AI yet — the manual path *is* the fallback path forever, so it's built first and honestly. Empty states teach the loop (10 §3). Entries accumulate from this week on (capture-first rule).

**Gate (playbook Phase-1):** a stranger could sign up on their phone, capture an entry, create a knowledge object with evidence, and their data is provably theirs alone — adversarial isolation suite green over every function that exists.

## Phase 2 — Verification harness (wk 2–3)

Built after ~3 features, per the playbook's regret. Vitest + convex-test wiring; the isolation registry check; Playwright boot/pre-clean/testid infrastructure; capture-loop E2E for the manual path; AI stub provider flag (11 §3). Pure libs extracted where logic already crept into components.

**Gate:** full pipeline including tagged E2E is the only way anything ships from here on.

## Phase 3 — The AI loop (wk 3–4) · *the product becomes Atlas*

- `ai/embed` + Voyage + vector indexes; hybrid search (list results only).
- `ai/distill` → proposals; **review queue** with op-level approve/edit/reject; `applyProposal` with revisions + provenance.
- `ai/connect` v1: evidence cross-links + `contradicts` surfacing (pattern-proposal heuristic can lag).
- `aiRuns` logging + daily budget + honest budget copy.
- **Issue inbox + crash reporting + owner ops panel** (playbook Phase 3 — lands with the first AI feature, since owner-as-tester starts now; ops panel = append-only sections: aiRuns/budget, crashes, issues).
- Evals fixture set v1; first logged eval run.

**Gate:** entry → distill → review → approved knowledge with full provenance, on the phone, AI failures degrading gracefully (capture/browse unaffected). Distillation approval-rate measurable.

## Phase 4 — Knowledge depth (wk 4–5)

Relationships (manual + AI-proposed); experiments + outcomes + outcome-evidence proposals; confidence computation live with override + drift display; revision history UI; Ask synthesis with citations; Contradictions view; paste-import (`conversation` kind); Export JSON.

**Gate:** the vision's provenance questions all answerable from the object detail screen; experiment loop closes (outcome moves a confidence label).

## Phase 5 — MCP / Hermes (wk 5–6)

`/mcp` httpAction + Streamable HTTP; API keys UI with scopes; full tool set (06 §3); MCP contract suite; Hermes persona doc + connection snippets for Claude app/Code. Owner starts *living* the Hermes workflow — this is the MVP's real-world trial.

**Gate:** from a fresh Claude client with a fresh key: capture an entry, retrieve context, submit a proposal, see it pend in the review queue, approve it in the PWA — and the contract suite's safety invariants (no direct knowledge mutation exists) pass.

## Phase 6 — Reviews + platform hardening (wk 6–7)

- Daily reflection + weekly review crons; review inbox UI; tone eval logged.
- **iOS PWA hardening as one deliberate pass** — the playbook Phase-4 checklist wholesale: ≥16px inputs sweep, `pan-x pan-y`, `overflow-x-clip` on scrollers, `--app-h` keyboard-viewport pinning, static bottom nav, no autofocus, editors-full-screen audit, icon PNGs (renamed on change), push-only/offline-fallback SW, PWA-container session note in onboarding.

**Gate:** two weeks of the owner using Atlas daily on-phone (capture → review → weekly review) with zero unfiled bugs — "no news means no crashes" verified via the crash panel, not assumed.

## Pre-launch gate — before ANY non-owner account

Four-audit review, fanned out as independent subagent lenses (playbook):
1. Onboarding funnel as a naive stranger (including MCP connection flow).
2. Cross-user isolation, hostile-minded, function by function + MCP tool by tool.
3. Solo-user assumptions (OWNER_CLERK_ID leaks into features? singular-user copy? hardcoded ids?).
4. Operational readiness (Convex quotas, budget math, index coverage, error visibility, N+1 query review).

Plus launch checklist: billing off free tier + alerts; PITR on; accepted-risk register reviewed (08 §6 — open-signup trigger fires here); export verified on real data volume.

## Post-MVP (ordered by the vision's pull, gated on real usage signal)

1. **In-app Hermes chat** (07 Phase B) — trigger: approval rate ≥60% and the review loop habitual.
2. Monthly/quarterly reviews — trigger: 8+ weeks of data.
3. Auto-distill maturation (batching, digest-style proposals) — trigger: manual Distill felt as friction, not control.
4. Chat-export parsers (Claude/ChatGPT formats) for conversation import.
5. OAuth for MCP; then graph visualization, analytics — only against demonstrated need (vision excludes them from MVP for good reason).

## Standing don'ts (from the playbook's Don't column)

No second feature during Phase 0/1. No visual polish before the harness. No new features during the hardening pass or pre-launch review. No building ahead of user signal post-MVP. Reviews and taste calls stay with the smartest model; delegated bulk output always verified.
