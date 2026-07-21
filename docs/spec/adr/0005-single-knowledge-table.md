# ADR-0005: One `knowledge` table with a `type` field, not a table per type

Status: Accepted

## Context
The vision names Observation, Interpretation, Insight, Pattern, Principle, and Question as first-class objects, and its hierarchy implies distinct levels. Modeling options: six tables, or one table with a type enum.

## Decision
One `knowledge` table; `type` is a validated enum field. Experiments and Outcomes get their own tables (genuinely different shapes). Evidence, Relationship, Revision are edge/log tables.

## Consequences
- Every behavior the six types share — statement, confidence, evidence, revisions, relationships, search, archival, proposal ops — is implemented once. Six tables would mean six copies of queries, mutations, isolation tests, and indexes for zero semantic gain.
- The hierarchy is expressed by `relationships` (`derives-from`, `generalizes`), not by table boundaries — promotion (insight → pattern) creates a linked object instead of destructively mutating type, preserving history.
- Type-specific rules (e.g., pattern expects ≥3 distinct sources) live in `convex/lib/` checks keyed on type — cheap to add, easy to test.
- `interpretation` stays in the enum but out of the MVP UI (00-overview deviation-4): schema stability without UX burden.
- Risk accepted: if a type someday needs a truly divergent shape, it graduates to its own table via migration; the enum + relationships design makes that additive.
