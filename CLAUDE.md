# Atlas

AI-native personal knowledge OS: entries (evidence) → AI-proposed knowledge (user-approved) → experiments → refined understanding. Full engineering spec in `docs/spec/` — **read `docs/spec/00-overview.md` first**; product vision in `docs/vision.md`.

## Stack (locked — see ADRs before proposing changes)

Next.js (App Router) PWA + Tailwind v4 on Vercel · Convex (db/functions/crons/vector) · Clerk (auth) · OpenAI API (GPT-5.6 + text-embedding-3) · MCP server as Convex httpAction at `/mcp` · bun.

## Non-negotiable invariants

1. **Subject scoping:** every public Convex function starts with `requireUser(ctx)`; no function accepts a client-supplied `userId`; every index leads with `userId`; every `db.get` is followed by an ownership assertion.
2. **Proposal gate:** AI actors (pipeline, MCP, Hermes) mutate knowledge/evidence/relationships/experiments ONLY via `proposals` rows applied by `applyProposal`. Direct-write exception: MCP `atlas_create_entry` only (ADR-0009). No new exceptions without an ADR.
3. **Business logic exactly once:** in Convex functions + `convex/lib/` (pure, injected time). PWA and MCP are thin clients of the same internals.
4. **Provenance:** every knowledge/experiment mutation writes a `revisions` snapshot with actor + reason.
5. AI never sets `confidence` — it's computed in `convex/lib/confidence.ts` from distinct evidence.

## Working rules

- Ship only through the pipeline: `bun run typecheck && bun run lint && bun run test` → tagged e2e → deploy → smoke → append a line to `LEDGER.md` (git-ignored).
- Every interactive element gets a `data-testid` at creation.
- New public function ⇒ add its row to the adversarial isolation test registry (suite fails otherwise, by design).
- Prompt changes bump `PROMPT_VERSION` and require a logged eval run (`docs/evals/LOG.md`).
- Design tokens: MERIDIAN (`docs/spec/10-ux-spec.md` §1). No new colors/sizes outside tokens. Honest copy always (no fake success states). No gamification, streaks, or engagement mechanics — ever (product values).
- Roadmap phases and gates: `docs/spec/12-roadmap.md`. Don't skip gates; if the user asks to, name the gate and the cost first.
- Acceptance criteria ids (AC-x.y in `docs/spec/13-acceptance-criteria.md`) are referenced in test names — keep the mapping.
