// Distill's context loader (Phase 3a Task 6). Internal only (08 §2): explicit
// userId, no isolation row needed (registry only covers public functions).
//
// Knowledge context ranking is a PRE-EMBEDDING FALLBACK: we rank active knowledge
// by its most-recent revision timestamp (a proxy for "recently relevant"), not by
// semantic similarity to the entry. Phase 3b upgrades this to vector-nearest +
// cosine dedup once embeddings exist (docs/superpowers/plans/2026-07-22-phase-3a-ai-loop.md).
import { ConvexError, v } from 'convex/values';
import { internalQuery } from '../_generated/server';

const KNOWLEDGE_CONTEXT_LIMIT = 12;

export const load = internalQuery({
  args: { userId: v.id('users'), entryId: v.id('entries') },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (entry === null || entry.userId !== args.userId) {
      throw new ConvexError({ code: 'not_found', message: 'Entry not found.' });
    }

    const active = await ctx.db
      .query('knowledge')
      .withIndex('by_user_status_type', (q) => q.eq('userId', args.userId).eq('status', 'active'))
      .collect();

    const withLatestRevision = await Promise.all(
      active.map(async (k) => {
        const latest = await ctx.db
          .query('revisions')
          .withIndex('by_target', (q) =>
            q.eq('userId', args.userId).eq('targetType', 'knowledge').eq('targetId', k._id),
          )
          .order('desc')
          .first();
        return { knowledge: k, latestAt: latest?._creationTime ?? k._creationTime };
      }),
    );

    const knowledgeContext = withLatestRevision
      .sort((a, b) => b.latestAt - a.latestAt)
      .slice(0, KNOWLEDGE_CONTEXT_LIMIT)
      .map(({ knowledge: k }) => ({
        id: k._id as string,
        type: k.type,
        statement: k.statement,
        confidence: k.confidence,
      }));

    return {
      entry: {
        id: entry._id as string,
        body: entry.body,
        kind: entry.kind,
        occurredAt: entry.occurredAt,
      },
      knowledgeContext,
    };
  },
});
