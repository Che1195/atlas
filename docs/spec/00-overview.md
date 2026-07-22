# Atlas Engineering Specification — Overview

Version: 1.0 · Date: 2026-07-21
Source: `docs/vision.md` (Product Vision v0.1)
Status: Approved baseline for implementation. Future sessions implement against this spec; changes to architecture-level decisions require a new ADR, not ad-hoc drift.

## Document map

| Doc | Contents |
|---|---|
| [01-prd.md](01-prd.md) | Product requirements, personas, MVP scope, success measures |
| [02-architecture.md](02-architecture.md) | System architecture, deployable pieces, layer responsibilities |
| [03-domain-model.md](03-domain-model.md) | Objects, invariants, lifecycles, confidence model |
| [04-database-schema.md](04-database-schema.md) | Convex schema: tables, validators, indexes |
| [05-ai-pipeline.md](05-ai-pipeline.md) | Distillation, connection, contradiction, reviews, embeddings, cost control |
| [06-mcp-interface.md](06-mcp-interface.md) | MCP server: tools, schemas, auth, error contract |
| [07-hermes.md](07-hermes.md) | Hermes phasing: MCP-first now, in-app agent later |
| [08-security-model.md](08-security-model.md) | Threat model, isolation invariant, data protection |
| [09-authentication.md](09-authentication.md) | Clerk setup, Convex JWT wiring, API keys |
| [10-ux-spec.md](10-ux-spec.md) | Screens, flows, design tokens (MERIDIAN), empty states |
| [11-testing-strategy.md](11-testing-strategy.md) | Unit / convex-test / E2E / MCP contract / AI eval layers |
| [12-roadmap.md](12-roadmap.md) | Phased build order with gates (playbook-adapted) |
| [13-acceptance-criteria.md](13-acceptance-criteria.md) | Given/When/Then per MVP capability |
| [adr/](adr/) | Architectural decision records 0001–0010 |

## Locked stack decisions (user-approved 2026-07-21)

- **Client:** Mobile-first PWA. Next.js (App Router) + React + TypeScript + Tailwind, deployed on Vercel. ([ADR-0001](adr/0001-mobile-first-pwa.md))
- **Backend:** Convex — database, domain functions, scheduler, vector search. ([ADR-0002](adr/0002-convex-backend.md))
- **Auth:** Clerk, integrated with Convex via JWT. ([ADR-0003](adr/0003-clerk-auth.md))
- **AI:** OpenAI API for generation and embeddings. ([ADR-0011](adr/0011-openai-provider.md), supersedes [ADR-0008](adr/0008-claude-and-voyage.md))
- **Hermes:** MCP-first — MVP ships the MCP server; the in-app chat agent is post-MVP. ([ADR-0007](adr/0007-mcp-first-hermes.md))

## Where this spec deliberately deviates from the vision

The vision doc invited challenge. These are the deviations, each argued in full in its ADR or doc:

1. **The 8-layer architecture collapses to 3 deployable pieces.** "Mobile App → Application API → Domain Layer → Database → Knowledge Engine → AI Layer → MCP Server → Hermes" is a responsibility list, not a deployment topology. Implementing it as 8 separate layers would violate the vision's own rule that business logic exists exactly once. See [02-architecture.md](02-architecture.md).
2. **One `knowledge` table with a `type` field, not six object tables.** Observation, Interpretation, Insight, Pattern, Principle, and Question share an identical shape (statement, confidence, evidence, revisions, relationships). Six tables would mean six copies of every query, mutation, and rule. ([ADR-0005](adr/0005-single-knowledge-table.md))
3. **Confidence and type are separated.** The vision's confidence ladder includes "Emerging Pattern", which conflates *what kind of knowledge this is* with *how well-supported it is*, and "Archived", which is a lifecycle status, not a confidence level. The spec uses two orthogonal fields: `confidence` (hypothesis → contradicted) and `status` (active/archived). See [03-domain-model.md](03-domain-model.md).
4. **`Interpretation` is in the schema but not in the MVP UI.** The Observation/Interpretation distinction is epistemically sound but too heavy a taxonomy to impose on a user at capture time. The type exists in the enum; the UI surfaces it post-MVP if the distinction earns its keep.
5. **MCP entry capture writes directly; everything else proposes.** The vision says Hermes "proposes entries," but entries are raw evidence, not knowledge — forcing approval on capture would kill the frictionless capture the same vision demands. Knowledge mutations remain strictly proposal-gated. ([ADR-0009](adr/0009-direct-entry-capture.md))
6. **MVP reviews are daily + weekly only.** Monthly and quarterly reviews need months of accumulated data to be non-trivial; shipping them in MVP means shipping empty screens. They are fast follows.
7. **Conversation import in MVP = paste-as-entry.** Parsers for specific chat-export formats are post-MVP; a paste box with a `conversation` entry kind covers the MVP need.
8. **Confidence is computed as a suggestion, confirmed by the user.** Pure function over distinct-source evidence; the AI never sets confidence, and the user's override is itself a recorded revision. ([ADR-0010](adr/0010-computed-confidence.md))

## Non-negotiable invariants (all future sessions)

1. **Subject scoping:** every Convex function derives the acting user from `ctx.auth` server-side. No function ever accepts a target `userId` from the client. (Playbook V1 leak class.)
2. **Proposal gate:** no code path lets an AI actor (pipeline, MCP client, future Hermes) create or mutate a knowledge object, evidence link, relationship, experiment, or outcome except through an approved proposal. The single writer is `applyProposal`.
3. **Provenance completeness:** every knowledge object and every revision records who (user / AI-proposed-user-approved), from what (source refs), and why (reason string).
4. **Business logic exactly once:** in Convex functions and `convex/lib/`. The Next.js app and the MCP server are both thin clients of the same functions.
5. **Ship through the pipeline:** typecheck → lint → unit → convex-test → E2E (tagged) → deploy → smoke check → ledger line. Never outside it.
