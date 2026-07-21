# ADR-0002: Convex as the backend

Status: Accepted (user decision, 2026-07-21)

## Context
Atlas needs: a document store for a personal-scale knowledge graph, transactional multi-object mutations (proposal application), realtime UI, scheduled jobs (reviews), vector search (retrieval), and strict per-user isolation — with one developer operating it. Alternatives considered: Postgres + Drizzle (Neon/Supabase), Firebase/Firestore.

## Decision
Convex: database + typed functions + scheduler + vector/full-text search in one deployment; Clerk first-class; built-in dev/prod separation.

## Consequences
- Playbook Phase-0 items satisfied natively: two environments, schema validators as the persisted-key allowlist, serializable mutations make uniqueness checks safe.
- ACID mutations make `applyProposal` (create knowledge + evidence + relationships + revisions atomically) trivial — the single most important write in the system.
- Accepted costs: no SQL/recursive graph queries (traversals are indexed-lookup loops in TS — fine at personal scale); platform coupling (mitigated by the always-available full JSON export); polymorphic references stored as strings with discriminators.
- Rejected: Postgres (stronger graph/analytics, but we'd hand-build realtime, migrations, and env discipline for queries Atlas doesn't need); Firestore (playbook-native but poor fit for revision-heavy graph data and not in the preferred stack).
