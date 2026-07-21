# 01 — Product Requirements Document

## 1. Problem

Journaling tools preserve memories; none preserve *conclusions*. A person who reflects regularly still cannot answer "what have I actually learned, and how sure am I?" because their learning is buried in prose, never tested, and silently contradicted by later entries. Atlas is a knowledge refinement engine: it turns experience (entries) into explicit, evidence-linked, revisable knowledge objects, and closes the loop with behavioral experiments.

## 2. Persona and deployment model

- **Persona:** a single reflective adult who journals or wants to, is comfortable with an AI reading their reflections, and wants their beliefs tested rather than affirmed.
- **Deployment:** multi-tenant from day one (each account fully isolated), but every account is single-player. No sharing, no collaboration, ever in this spec's scope. Building multi-tenant now is nearly free in Convex and avoids the playbook's most expensive retrofit class.
- **First user is the owner/developer.** The playbook's "four-audit review" gate applies before any non-owner account exists.

## 3. Product goals → requirements

| Vision goal | Requirement |
|---|---|
| Capture meaningful experiences | Frictionless entry capture: < 5 s from app open to typing; also capturable via MCP (Hermes) |
| Extract useful insights | AI distillation of entries into *proposed* knowledge objects with cited evidence |
| Detect recurring patterns | Connection pass: AI links new evidence to existing knowledge; proposes pattern objects over ≥3 distinct supporting sources |
| Build evidence-backed principles | Promotion path insight → pattern → principle via relationships; confidence computed from distinct evidence |
| Run behavioral experiments | Experiment objects with hypothesis/behavior/criteria; outcomes feed evidence back to the tested knowledge |
| Review personal growth | Generated daily reflection + weekly review; factual tone enforced by prompt contract |
| Retrieve relevant prior knowledge | Semantic + keyword search over knowledge and entries; question-answering retrieval bundle |
| Understand why conclusions were reached | Every object shows evidence for/against, revision history with reasons, and origin (user vs AI-proposed) |
| Challenge existing beliefs | Contradiction surfacing: evidence with `contradicts` stance flips confidence to `mixed`/`contradicted`; review queue shows contradictions first |
| Improve future decision making | "Ask Atlas" retrieval; principles surfaced by relevance, not recency |

## 4. MVP scope

### P0 — the loop (nothing ships to a second user without all of these)

1. **Auth & account** — Clerk sign-up with display name captured at signup; account deletion; timezone setting.
2. **Capture** — create/edit/view entries (kinds: `journal`, `conversation`, `note`); paste-import of conversations.
3. **Distillation** — user triggers (or enables auto) AI distillation of an entry → a proposal containing observation/insight ops with evidence citations.
4. **Review queue** — op-level approve/reject/edit-then-approve; applying writes knowledge + evidence + revisions transactionally.
5. **Knowledge base** — browse/filter by type, confidence, status; object detail with statement, evidence for/against, revisions, relationships.
6. **Revision history** — every mutation snapshot-logged with actor + reason; visible per object.
7. **Search & Ask** — full-text + vector search; "Ask" returns a synthesized answer with citations to objects/entries.
8. **Export** — one-tap full JSON export of all user data.

### P1 — completes the MVP as specified in the vision

9. **Experiments & outcomes** — create from an insight (manually or from AI suggestion); record outcome; outcome auto-proposes evidence against the tested object.
10. **Relationships** — typed links between knowledge objects (`derives-from`, `generalizes`, `contradicts`, `relates-to`, `answers`, `supersedes`); AI may propose them.
11. **Contradiction surfacing** — connection pass flags new evidence contradicting existing knowledge; dedicated "Contradictions" view.
12. **Reviews** — scheduled daily reflection + weekly review generation; review inbox.
13. **MCP server** — full read + propose surface with per-client API keys (this *is* Hermes integration for MVP, per ADR-0007).
14. **Issue inbox + crash reporting** — in-app issue filing and client error capture (playbook Phase 3; cheap and load-bearing).

### Explicitly out of MVP (vision exclusions + spec deviations)

Social/collaboration, voice, image understanding, autonomous agents, graph visualization, complex analytics, desktop app, native mobile app, in-app Hermes chat (post-MVP fast follow), monthly/quarterly reviews, chat-export format parsers, offline-first sync (PWA works online; capture degrades to a local draft that syncs on reconnect).

## 5. Success measures

Per the vision's values (no engagement optimization), measures are *wisdom proxies*, not usage metrics:

- **Evidence density:** median distinct evidence sources per active knowledge object ≥ 2 after 60 days of use.
- **Revision liveness:** ≥ 30% of knowledge objects older than 30 days have at least one revision (beliefs are actually being refined, not fossilizing).
- **Contradiction honesty:** contradicting evidence is attached and at least sometimes accepted (a system where nothing is ever contradicted is failing at "truth over comfort").
- **Experiment closure:** > 50% of started experiments reach a recorded outcome.
- **Proposal quality:** ≥ 60% of AI-proposed ops approved (possibly after edit). Below that, the distillation prompt is failing and must be revised.
- **Retrieval usefulness:** "Ask Atlas" answers cite ≥ 1 relevant object for questions about topics with existing knowledge.

Anti-metrics (must never be optimized): session count, streaks, time-in-app, entry volume.

## 6. Constraints

- Single developer + AI agents; cost-conscious Claude API usage with per-user daily budget (05-ai-pipeline §7).
- Privacy over engagement: no third-party analytics; crash/issue reporting is first-party (own Convex tables).
- All spend on Convex/Clerk/Vercel free-or-hobby tiers until the four-audit gate; billing + alerts configured before any non-owner user.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Distillation quality poor → review queue becomes spam → user abandons loop | Op-level reject with reason capture; prompt versioning + approval-rate measure; conservative distillation (fewer, better ops) |
| Taxonomy too heavy (6 knowledge types) at capture time | AI proposes types; user never has to pick one from scratch; `interpretation` hidden in MVP UI |
| Confidence math feels arbitrary | Confidence is a *suggestion* with the computation shown ("3 supporting sources, 1 contradicting"); user confirms |
| MCP-first Hermes makes MVP feel headless | The PWA review queue is the product's center of gravity; MCP adds capture/retrieval from Claude, not the primary UX |
| AI cost runaway from auto-distillation | Manual trigger default; auto mode opt-in with daily token budget and visible run log |
