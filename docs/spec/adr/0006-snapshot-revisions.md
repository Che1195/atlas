# ADR-0006: Snapshot-based revision history

Status: Accepted

## Context
"Every object maintains revision history" (vision). Options: full snapshots per change, JSON-patch diffs, or event sourcing.

## Decision
Full domain-field snapshots in a `revisions` table, written in the same mutation as every knowledge/experiment change, with `actor`, `reason`, and optional `proposalId`.

## Consequences
- Knowledge objects are small (a statement + short body); snapshot storage cost is negligible while making "view this object as of revision 3" a single read — no patch replay, no reconstruction bugs.
- Reviews compute confidence transitions by comparing consecutive snapshots — trivially.
- Event sourcing rejected: maximal provenance in theory, but the proposals table already records *why* changes happened; sourcing would make every read a fold for a single-developer project.
- Diffs rejected as false economy: storage is cheap, replay correctness is not.
- Entries deliberately have no revisions (they're evidence, not conclusions; `editedAt` suffices) — revising history of raw evidence would actually undermine the epistemics.
