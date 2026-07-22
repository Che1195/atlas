// MCP bearer-key auth support (Phase M Task 4, docs/spec/06 §1, 08 §3). Internal
// only — httpAction contexts have no ctx.db, so convex/mcp/auth.ts (the
// orchestrator, running inside the httpAction) reaches the apiKeys table only
// through these internalQuery/internalMutation functions. Explicit userId is N/A
// here (these take keyHash/keyId, not a subject) — this is auth resolution
// itself, the layer that PRODUCES the userId every other internal function
// requires as its first param (08 §2).
import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';

/** Fixed window: 60 requests/min per key (06 §1). */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_PER_WINDOW = 60;
/** lastUsedAt bump throttle — once per minute is enough for the Connections screen. */
const LAST_USED_THROTTLE_MS = 60_000;

/** Look up an API key row by its SHA-256 hash. Null when no such key exists. */
export const findByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('apiKeys')
      .withIndex('by_hash', (q) => q.eq('keyHash', args.keyHash))
      .unique();
  },
});

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Fixed-window rate check + throttled lastUsedAt bump, in one mutation so the
 * read-then-patch is atomic within Convex's single-writer-per-document model.
 * Called once per authenticated MCP request, AFTER the key is confirmed valid
 * and unrevoked (revoked keys never reach here, so they never consume window
 * budget or bump lastUsedAt).
 */
export const recordUse = internalMutation({
  args: { keyId: v.id('apiKeys'), now: v.number() },
  handler: async (ctx, args): Promise<RateLimitResult> => {
    const row = await ctx.db.get(args.keyId);
    if (row === null) return { allowed: true }; // defensive; caller already validated existence

    const windowStart = row.rateWindowStart;
    const withinWindow = windowStart !== undefined && args.now - windowStart < RATE_LIMIT_WINDOW_MS;
    const currentCount = withinWindow ? (row.rateWindowCount ?? 0) : 0;

    if (withinWindow && currentCount >= RATE_LIMIT_MAX_PER_WINDOW) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart! + RATE_LIMIT_WINDOW_MS - args.now) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }

    const patch: Record<string, unknown> = {
      rateWindowStart: withinWindow ? windowStart : args.now,
      rateWindowCount: currentCount + 1,
    };
    if (row.lastUsedAt === undefined || args.now - row.lastUsedAt >= LAST_USED_THROTTLE_MS) {
      patch.lastUsedAt = args.now;
    }
    await ctx.db.patch(args.keyId, patch);
    return { allowed: true };
  },
});
