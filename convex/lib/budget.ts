// Daily AI token budget (docs/spec/05-ai-pipeline.md §4). PURE — no ctx, no Date.now();
// callers pass `nowMs` explicitly so this stays deterministic and testable.

/**
 * The UTC calendar day containing `nowMs`, as a half-open [start, end) ms range.
 * NOTE: this is a UTC day, not the user's local day — per-user-timezone windows
 * are a Phase 3b refinement (docs/superpowers/plans/2026-07-22-phase-3a-ai-loop.md).
 */
export function dayWindow(nowMs: number): { start: number; end: number } {
  const start = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return { start, end: start + DAY_MS };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether another run is allowed given tokens already spent today. A budget of
 * zero or less means nothing is allowed, regardless of spend (refuses even the
 * first run — "no budget configured" fails closed, not open).
 */
export function withinBudget(spentTokens: number, budget: number): boolean {
  if (budget <= 0) return false;
  return spentTokens < budget;
}
