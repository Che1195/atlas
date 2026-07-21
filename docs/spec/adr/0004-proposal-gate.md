# ADR-0004: All AI knowledge mutations flow through proposals

Status: Accepted

## Context
The vision's AI philosophy: "The AI should never silently create permanent knowledge. Every meaningful mutation requires user review." This needs to be structural, not behavioral — a prompt instruction is not a guarantee, especially with third-party MCP clients and pasted content that may contain prompt injection.

## Decision
A `proposals` table of typed ops is the only path by which any AI actor (distillation, connection, outcome drafting, MCP clients, future in-app Hermes) can affect knowledge, evidence, relationships, experiments, or archival. `applyProposal` — invoked only by the authenticated user from the review queue — is the single writer. Ops are resolved individually (approve/edit/reject per op).

## Consequences
- The approval gate doubles as the prompt-injection firewall: worst-case model output is a bad *pending proposal*.
- Provenance falls out for free: every AI-originated change carries proposal id → source, model, prompt version, citations, and the user's resolution.
- Op-level resolution avoids all-or-nothing review fatigue and produces a per-op approval-rate signal used to judge prompt quality (PRD §5).
- Cost: review is mandatory friction. Accepted as the product's core stance ("transparency over automation"); mitigated by conservative distillation (0–4 ops) and one-tap approve.
- User direct edits share the op-application lib (same revisions/provenance) but skip the proposal row — the gate is for non-human actors.
