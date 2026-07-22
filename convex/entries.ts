import { v } from 'convex/values';
import { internal } from './_generated/api';
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

/**
 * Schedule a distill run for this entry (Phase 3a Task 6). Budget refusal happens
 * inside the action, not here, so the message stays honest even under races —
 * this always schedules and returns immediately.
 */
export const requestDistill = mutation({
  args: { id: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    await ctx.scheduler.runAfter(0, internal.ai.distill.run, {
      userId: user._id,
      entryId: entry._id,
    });
    return { scheduled: true as const };
  },
});

/**
 * Drives the entry-detail Distill button's state. Derived from the newest aiRun
 * whose runId has the `distill:{entryId}:` prefix (by_runId is a GLOBAL exact-match
 * index, so we scan this user's 'distill' purpose rows and filter by prefix instead).
 */
export const distillStatus = query({
  args: { id: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    assertOwner(await ctx.db.get(args.id), user);

    const prefix = `distill:${args.id}:`;
    const rows = await ctx.db
      .query('aiRuns')
      .withIndex('by_user', (q) => q.eq('userId', user._id).eq('purpose', 'distill'))
      .collect();
    const matches = rows.filter((row) => row.runId.startsWith(prefix));
    if (matches.length === 0) return 'none' as const;

    const newest = matches.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
    if (newest.status === 'running') return 'running' as const;
    if (newest.status === 'error') {
      return newest.error === 'budget' ? ('budget' as const) : ('error' as const);
    }
    if (newest.proposalId === undefined) return 'empty' as const;
    // A proposal only keeps the entry "distilled" while it's still pending —
    // once it's resolved/superseded/expired (or somehow missing), re-distill
    // must be available again rather than showing a stale "Distilled ✓".
    const proposal = await ctx.db.get(newest.proposalId);
    if (proposal === null || proposal.status !== 'pending') return 'none' as const;
    return 'proposed' as const;
  },
});
