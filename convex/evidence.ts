import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { computeConfidence, type EvidenceSource } from './lib/confidence';
import { knowledgeSnapshot } from './lib/revisions';

const stance = v.union(v.literal('supports'), v.literal('contradicts'), v.literal('neutral'));

/**
 * Recompute suggested confidence after evidence changed (spec 03 §5).
 * Auto-applies only while confidenceOverridden is false; a label change is a
 * knowledge mutation, so it writes a revision (provenance invariant).
 */
async function recomputeConfidence(ctx: MutationCtx, user: Doc<'users'>, knowledge: Doc<'knowledge'>) {
  const rows = await ctx.db
    .query('evidence')
    .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', knowledge._id))
    .collect();

  const duplicateOf: Record<string, string> = {};
  for (const row of rows) {
    if (row.sourceType !== 'entry') continue;
    const entryId = ctx.db.normalizeId('entries', row.sourceId);
    const entry = entryId === null ? null : await ctx.db.get(entryId);
    if (entry !== null && entry.userId === user._id && entry.duplicateOf !== undefined) {
      duplicateOf[entry._id] = entry.duplicateOf;
    }
  }

  const { suggested, supports, contradicts } = computeConfidence(
    rows.map(
      (row): EvidenceSource => ({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        stance: row.stance,
      }),
    ),
    duplicateOf,
  );

  if (knowledge.confidenceOverridden || suggested === knowledge.confidence) return;

  const rev = knowledge.rev + 1;
  await ctx.db.patch(knowledge._id, { confidence: suggested, rev });
  const updated = await ctx.db.get(knowledge._id);
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'knowledge',
    targetId: knowledge._id,
    rev,
    snapshot: knowledgeSnapshot(updated!),
    actor: 'user',
    reason: `Confidence recomputed: ${knowledge.confidence} → ${suggested} (${supports} supporting, ${contradicts} contradicting)`,
  });
}

/** Link an entry as evidence. Upserts on the unique (knowledge, source) pair. */
export const add = mutation({
  args: {
    knowledgeId: v.id('knowledge'),
    entryId: v.id('entries'),
    stance,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const knowledge = assertOwner(await ctx.db.get(args.knowledgeId), user);
    const entry = assertOwner(await ctx.db.get(args.entryId), user);
    const existing = await ctx.db
      .query('evidence')
      .withIndex('by_unique', (q) =>
        q
          .eq('userId', user._id)
          .eq('knowledgeId', knowledge._id)
          .eq('sourceType', 'entry')
          .eq('sourceId', entry._id),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { stance: args.stance, note: args.note });
    } else {
      await ctx.db.insert('evidence', {
        userId: user._id,
        knowledgeId: knowledge._id,
        sourceType: 'entry',
        sourceId: entry._id,
        stance: args.stance,
        note: args.note,
        origin: 'user',
      });
    }
    await recomputeConfidence(ctx, user, knowledge);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id('evidence') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = assertOwner(await ctx.db.get(args.id), user);
    const knowledge = assertOwner(await ctx.db.get(row.knowledgeId), user);
    await ctx.db.delete(row._id);
    await recomputeConfidence(ctx, user, knowledge);
    return null;
  },
});
