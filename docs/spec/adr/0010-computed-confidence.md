# ADR-0010: Confidence is computed from distinct evidence, user-overridable, never AI-set

Status: Accepted

## Context
The vision requires confidence levels but warns: "Confidence should never be determined solely by repetition. Repeated summaries of the same event are not additional evidence." Options: AI-judged confidence, purely manual labels, or computed-from-evidence.

## Decision
A pure function (`convex/lib/confidence.ts`) computes a suggested confidence from counts of *distinct* supporting/contradicting sources (dedup via `entries.duplicateOf`; experiment outcomes double-weighted). The suggestion auto-applies until the user overrides; overrides are revisions with reasons; post-override drift between label and suggestion is displayed, never silently resolved. No proposal op or MCP tool can set confidence.

## Consequences
- The repetition guard is arithmetic, not judgment: N retellings of one event = one source.
- Confidence is always explainable ("3 distinct sources, 1 contradicting") — shown wherever the label appears, satisfying "understand why conclusions were reached."
- AI influence on confidence is exactly its influence on *evidence*, which is human-gated — layering the safety model instead of trusting model calibration.
- Separated from lifecycle: `status: archived` is not a confidence value (vision's ladder conflated them); `type: pattern` is not a confidence value either ("Emerging Pattern" → `tentative`).
- The thresholds are v1 heuristics; tuning them is a pure-function change with full unit coverage and no data migration (labels recompute).
