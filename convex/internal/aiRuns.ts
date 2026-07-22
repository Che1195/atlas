// AI run ledger (docs/spec/05-ai-pipeline.md — "no news must mean no crashes").
// Internal only ⇒ explicit userId first param (08 §2); no isolation row needed
// (tests/isolation.registry.ts only covers public functions).
import { ConvexError, v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';
import { dayWindow } from '../lib/budget';

const purpose = v.union(
  v.literal('distill'),
  v.literal('connect'),
  v.literal('review'),
  v.literal('ask'),
  v.literal('embed'),
);

/**
 * Idempotent start: a retried call with the same runId (e.g. a scheduler retry)
 * patches the existing row back to 'running' (clearing any prior error) instead
 * of piling up duplicate ledger rows. by_runId is a GLOBAL index (not scoped to
 * userId), so we defense-in-depth check the existing row's userId matches the
 * caller's — a runId collision across users throws rather than silently
 * attaching one user's run to another's ledger row.
 */
export const start = internalMutation({
  args: {
    userId: v.id('users'),
    purpose,
    runId: v.string(),
    model: v.string(),
    promptVersion: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'aiRuns'>> => {
    const existing = await ctx.db
      .query('aiRuns')
      .withIndex('by_runId', (q) => q.eq('runId', args.runId))
      .unique();

    if (existing !== null) {
      if (existing.userId !== args.userId) {
        throw new ConvexError({ code: 'invalid_input', message: 'runId belongs to another user' });
      }
      await ctx.db.patch(existing._id, {
        status: 'running',
        model: args.model,
        promptVersion: args.promptVersion,
        // Explicit undefined REMOVES the key in Convex's patch — a reused runId
        // must start clean, not carry forward a stale proposal/token counts from
        // whatever the previous run at this runId happened to finish with.
        error: undefined,
        proposalId: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert('aiRuns', {
      userId: args.userId,
      purpose: args.purpose,
      runId: args.runId,
      model: args.model,
      promptVersion: args.promptVersion,
      status: 'running',
    });
  },
});

export const finish = internalMutation({
  args: {
    id: v.id('aiRuns'),
    status: v.union(v.literal('ok'), v.literal('error')),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    proposalId: v.optional(v.id('proposals')),
  },
  handler: async (ctx, args) => {
    // Convex's db.patch treats an explicitly-undefined key as REMOVE, not
    // leave-unchanged — so a later finish() that omits e.g. token counts
    // (attaching a proposalId after the fact) must not wipe fields an
    // earlier finish() already set. Only include keys the caller passed.
    const patch: Record<string, unknown> = { status: args.status };
    if (args.inputTokens !== undefined) patch.inputTokens = args.inputTokens;
    if (args.outputTokens !== undefined) patch.outputTokens = args.outputTokens;
    if (args.error !== undefined) patch.error = args.error;
    if (args.proposalId !== undefined) patch.proposalId = args.proposalId;
    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Sum of input+output tokens for this user's runs whose _creationTime falls in
 * today's UTC window. Deliberately includes error rows: a failed live call
 * (e.g. truncated/refused output) still billed those tokens, so it must still
 * count against the daily budget — only 'running' rows are exempt, and they
 * naturally contribute 0 since no tokens are recorded until finish(). Full scan
 * filtered by userId — fine at this scale (single-digit users, low run volume);
 * an index (e.g. by_user + _creationTime) is the obvious upgrade if this ever
 * shows up in profiling.
 */
export const spentToday = internalQuery({
  args: { userId: v.id('users'), nowMs: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const { start: windowStart, end: windowEnd } = dayWindow(args.nowMs);
    const rows = await ctx.db
      .query('aiRuns')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect();

    let total = 0;
    for (const row of rows) {
      if (row._creationTime < windowStart || row._creationTime >= windowEnd) continue;
      total += (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    }
    return total;
  },
});
