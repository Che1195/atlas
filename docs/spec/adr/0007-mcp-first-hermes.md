# ADR-0007: Hermes ships MCP-first; in-app chat is post-MVP

Status: Accepted (user decision, 2026-07-21)

## Context
Hermes (the conversational companion) could ship as an in-app chat agent (Claude API + tool loop + streaming UI + conversation storage — the single largest MVP line item) or as a persona running in existing MCP clients (Claude app / Claude Code) against Atlas's MCP server.

## Decision
MVP ships the MCP server as the complete Hermes surface, plus a distributed persona prompt (`docs/hermes-persona.md`). The in-app chat is Phase B, gated on the proposal loop proving itself (approval rate ≥ 60%).

## Consequences
- Weeks cut from MVP; the review queue (the actual product core) gets the attention.
- Every vision Hermes duty maps to an MCP tool; the approval gate is identical on both paths — Phase B reuses the same tool registry over a second transport, so nothing is throwaway.
- Accepted costs: Hermes conversations live client-side (mitigated by paste-import); onboarding requires connecting a client; tone is prompt-enforced not code-enforced.
- Auth: bearer API keys now; MCP OAuth only if third-party clients ever matter (08 §6 register).
