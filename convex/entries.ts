import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { requireNonEmpty } from './lib/validate';

const entryKind = v.union(v.literal('journal'), v.literal('conversation'), v.literal('note'));

export const create = mutation({
  args: {
    kind: entryKind,
    title: v.optional(v.string()),
    body: v.string(),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await ctx.db.insert('entries', {
      userId: user._id,
      kind: args.kind,
      title: args.title,
      body: requireNonEmpty(args.body, 'body'),
      occurredAt: args.occurredAt,
      source: 'app',
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('entries'),
    kind: v.optional(entryKind),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    const patch: Partial<typeof entry> = { editedAt: Date.now() };
    if (args.kind !== undefined) patch.kind = args.kind;
    if (args.title !== undefined) patch.title = args.title;
    if (args.body !== undefined) patch.body = requireNonEmpty(args.body, 'body');
    if (args.occurredAt !== undefined) patch.occurredAt = args.occurredAt;
    await ctx.db.patch(entry._id, patch);
    return null;
  },
});

/** Newest 50 non-archived entries (Capture screen's recent list). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('entries')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(50);
    return rows
      .filter((entry) => entry.archived !== true)
      .map((entry) => ({
        _id: entry._id,
        kind: entry.kind,
        title: entry.title,
        excerpt: entry.body.slice(0, 120),
        occurredAt: entry.occurredAt,
        source: entry.source,
        editedAt: entry.editedAt,
      }));
  },
});

/** Full entry + the evidence rows citing it ("This entry supports …"). */
export const get = query({
  args: { id: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    const citing = await ctx.db
      .query('evidence')
      .withIndex('by_source', (q) =>
        q.eq('userId', user._id).eq('sourceType', 'entry').eq('sourceId', args.id),
      )
      .collect();
    const citedBy = [];
    for (const evidenceRow of citing) {
      const knowledge = await ctx.db.get(evidenceRow.knowledgeId);
      if (knowledge === null || knowledge.userId !== user._id) continue;
      citedBy.push({
        evidenceId: evidenceRow._id,
        stance: evidenceRow.stance,
        knowledgeId: knowledge._id,
        statement: knowledge.statement,
      });
    }
    return { ...entry, citedBy };
  },
});

/** Delete when uncited; archive when evidence cites it (AC-2.4 — evidence integrity). */
export const remove = mutation({
  args: { id: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    const cited = await ctx.db
      .query('evidence')
      .withIndex('by_source', (q) =>
        q.eq('userId', user._id).eq('sourceType', 'entry').eq('sourceId', args.id),
      )
      .first();
    if (cited !== null) {
      await ctx.db.patch(entry._id, { archived: true });
      return { archived: true as const };
    }
    await ctx.db.delete(entry._id);
    return { deleted: true as const };
  },
});
