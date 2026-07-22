// Internal write path for proposals (called by the distill/connect/etc. actions —
// Phase 3a Task 6+). Internal ⇒ explicit userId first param (08 §2); no isolation
// row needed (tests/isolation.registry.ts only covers public functions).
import { ConvexError, v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { proposalOpValidator, validateOps } from '../shared/proposalOps';

const proposalSource = v.union(
  v.literal('distillation'),
  v.literal('connection'),
  v.literal('outcome'),
  v.literal('mcp'),
  v.literal('review'),
);

/**
 * Idempotent upsert: validates ops (throws on invalid — actions must never store
 * junk), supersedes any existing PENDING proposal with the same entryId + source
 * (AC-3.5 — re-distilling an entry replaces its stale pending proposal rather than
 * piling up), then inserts a fresh pending proposal with all-'pending' resolutions.
 */
export const upsertProposal = internalMutation({
  args: {
    userId: v.id('users'),
    source: proposalSource,
    runId: v.optional(v.string()),
    entryId: v.optional(v.id('entries')),
    ops: v.array(proposalOpValidator),
    rationale: v.string(),
    citations: v.array(
      v.object({
        sourceType: v.string(),
        sourceId: v.string(),
        excerpt: v.optional(v.string()),
      }),
    ),
    model: v.string(),
    promptVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const verdicts = validateOps(args.ops);
    const invalid = verdicts.find((verdict) => !verdict.valid);
    if (invalid) {
      throw new ConvexError({ code: 'invalid_input', message: invalid.error });
    }

    if (args.entryId !== undefined) {
      const existingForUser = await ctx.db
        .query('proposals')
        .withIndex('by_user_status', (q) => q.eq('userId', args.userId).eq('status', 'pending'))
        .collect();
      for (const row of existingForUser) {
        if (row.entryId === args.entryId && row.source === args.source) {
          await ctx.db.patch(row._id, { status: 'superseded' });
        }
      }
    }

    return await ctx.db.insert('proposals', {
      userId: args.userId,
      source: args.source,
      runId: args.runId,
      entryId: args.entryId,
      status: 'pending',
      ops: args.ops,
      opResolutions: args.ops.map(() => 'pending' as const),
      rationale: args.rationale,
      citations: args.citations,
      model: args.model,
      promptVersion: args.promptVersion,
    });
  },
});
