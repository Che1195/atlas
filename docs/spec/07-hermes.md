# 07 — Hermes Integration

Hermes is the conversational interface; Atlas is the knowledge system. The vision requires Hermes to work through authenticated APIs/MCP with no direct database access and no approval bypass. Decision (user-approved, ADR-0007): **Hermes ships MCP-first**; the in-app agent is a post-MVP fast follow.

## Phase A (MVP): Hermes = any capable MCP client

The user connects Claude (desktop/mobile app, or Claude Code) to Atlas's MCP server with a personal API key. A Hermes *persona* is distributed as a project/system prompt (kept in-repo at `docs/hermes-persona.md`) that instructs the client model to:

1. **Capture:** when the user reflects on an experience, offer to save it — `atlas_create_entry` with their words, minimally edited; ask for `occurredAt` if it isn't today; flag re-tellings via `duplicateOf`.
2. **Retrieve before reasoning:** answer "what have I learned about X" questions by calling `atlas_retrieve_context` / `atlas_search_knowledge` first and reasoning only over returned items, citing object ids.
3. **Propose, never assert:** when a conversation yields a candidate insight/pattern/relationship/experiment, run `atlas_preview_proposal`, fix validation issues, then `atlas_submit_proposal` — and tell the user it awaits their review in Atlas.
4. **Close loops:** check `atlas_list_proposals` for what was approved/rejected/edited and adapt future proposals accordingly; check `atlas_list_experiments` for active experiments and ask about observations when relevant.
5. **Respect the tone:** no praise, no motivation-speak; evidence over comfort (mirrors the review style contract).

Why this is enough for MVP: every Hermes responsibility in the vision (capture, retrieve, propose entries/experiments, record outcomes as proposals, explain relationships, prepare reviews) maps to an existing MCP tool, and the approval gate is structural — the server offers no bypass. The client model's quality (Claude) exceeds anything we'd ship in-app in the same timeframe.

Costs of this phase, accepted consciously: conversations live in the client, not Atlas (mitigation: paste-import as `conversation` entries); onboarding requires connecting a client (Settings → Connections ships copy-paste config for Claude app + Claude Code); tone contract is prompt-enforced, not code-enforced.

## Phase B (post-MVP): in-app Hermes

A chat surface inside the PWA, backed by a Convex action running Claude with the *same tool registry* the MCP server exposes (one tool-definition module, two transports — invariant #4). Adds: conversation persistence as first-class entries, inline proposal cards (approve in-chat = same `applyProposal`), review walk-throughs. Nothing in Phase A's architecture is discarded; the MCP tool layer *is* Hermes's toolbelt.

Trigger for building Phase B: the MVP loop is proven (approval rate ≥ 60%, user actually reviewing proposals) — building a chat UI on top of a mistuned proposal engine would gold-plate the wrong layer.
