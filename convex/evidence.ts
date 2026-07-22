import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { recomputeConfidence, upsertEvidence } from './ops/knowledgeWrites';

const stance = v.union(v.literal('supports'), v.literal('contradicts'), v.literal('neutral'));

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
    await upsertEvidence(
      ctx,
      user,
      knowledge,
      { sourceType: 'entry', sourceId: entry._id, stance: args.stance, note: args.note, origin: 'user' },
      { actor: 'user' },
    );
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
    await recomputeConfidence(ctx, user, knowledge, { actor: 'user' });
    return null;
  },
});
