# ADR-0009: MCP entry capture writes directly (scoped exception to the proposal gate)

Status: Accepted

## Context
The vision says Hermes "proposes entries," but also demands frictionless capture ("capture meaningful experiences") and states entries are *source documents*, not knowledge. Forcing every Hermes-captured reflection through the review queue would tax the exact behavior Atlas most needs to encourage, and reviewing one's own words captured seconds ago is ceremony without epistemics.

## Decision
`atlas_create_entry` (scope: `capture`) writes entries directly, marked `source: 'mcp'`. Everything downstream of an entry — any knowledge, evidence, or relationship derived from it — remains strictly proposal-gated (ADR-0004).

## Consequences
- Capture stays frictionless from any Hermes client; the knowledge base remains 100% human-approved.
- Risk: a misbehaving client could write noisy or distorted entries. Bounded by: entries never become knowledge without review; `source: 'mcp'` is visible provenance; entries are editable/archivable; the persona instructs faithful capture; keys are revocable and scope-separable (a `propose`-only key cannot capture).
- The exception is *scoped and named*: any future tool wanting direct-write must argue its own ADR; the default remains the gate.
