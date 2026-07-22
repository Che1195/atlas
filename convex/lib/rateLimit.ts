// Shared fixed-window rate-limit math (docs/spec/06-mcp-interface.md §1: "60
// requests/min per key or access token"). Pure — no ctx, no db. Used by both
// convex/internal/mcpAuth.ts (apiKeys) and convex/internal/oauthAuth.ts
// (oauthGrants) so the two token kinds share one window algorithm instead of
// two hand-maintained copies (Phase M Task 5 brief: "reuse fixed-window
// fields... same helper").
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_PER_WINDOW = 60;

export type RateLimitState = { rateWindowStart?: number; rateWindowCount?: number };

export type RateLimitResult =
  | { allowed: true; patch: { rateWindowStart: number; rateWindowCount: number } }
  | { allowed: false; retryAfterSeconds: number };

/** Given the current window state and now, decide allow/deny and the patch to persist on allow. */
export function checkRateLimit(state: RateLimitState, now: number): RateLimitResult {
  const withinWindow = state.rateWindowStart !== undefined && now - state.rateWindowStart < RATE_LIMIT_WINDOW_MS;
  const currentCount = withinWindow ? (state.rateWindowCount ?? 0) : 0;

  if (withinWindow && currentCount >= RATE_LIMIT_MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((state.rateWindowStart! + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }

  return {
    allowed: true,
    patch: {
      rateWindowStart: withinWindow ? state.rateWindowStart! : now,
      rateWindowCount: currentCount + 1,
    },
  };
}
