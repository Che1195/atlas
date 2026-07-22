// Embedding storage layer (Phase M Task 3, docs/spec/05-ai-pipeline.md §1 "embed").
// Internal only (08 §2): explicit userId, no isolation row needed (registry only
// covers public functions). Split from convex/ai/embed.ts because the embed action
// runs "use node" (needs the OpenAI SDK) while db reads/writes must go through
// ctx.runQuery/ctx.runMutation into ordinary (non-node) internal functions.
import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';
import { EMBED_VERSION } from '../ai/models';

const targetType = v.union(v.literal('entry'), v.literal('knowledge'));

/** The text to embed: entry body, or knowledge statement + body (joined). */
export const loadText = internalQuery({
  args: { userId: v.id('users'), targetType, targetId: v.string() },
  handler: async (ctx, args): Promise<{ text: string } | null> => {
    if (args.targetType === 'entry') {
      const id = ctx.db.normalizeId('entries', args.targetId);
      const entry = id === null ? null : await ctx.db.get(id);
      if (entry === null || entry.userId !== args.userId) return null;
      return { text: entry.body };
    }
    const id = ctx.db.normalizeId('knowledge', args.targetId);
    const knowledge = id === null ? null : await ctx.db.get(id);
    if (knowledge === null || knowledge.userId !== args.userId) return null;
    const text = knowledge.body ? `${knowledge.statement}\n\n${knowledge.body}` : knowledge.statement;
    return { text };
  },
});

/** Patch `embedding` + `embeddingVersion`. Re-verifies ownership (row may have been
 * deleted/reassigned between scheduling and running) — a miss is a silent no-op,
 * not an error, since embedding is fire-and-forget and a missing row is not a bug. */
export const write = internalMutation({
  args: {
    userId: v.id('users'),
    targetType,
    targetId: v.string(),
    embedding: v.array(v.float64()),
    embeddingVersion: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    if (args.targetType === 'entry') {
      const id = ctx.db.normalizeId('entries', args.targetId);
      if (id === null) return;
      const doc = await ctx.db.get(id);
      if (doc === null || doc.userId !== args.userId) return;
      await ctx.db.patch(id, { embedding: args.embedding, embeddingVersion: args.embeddingVersion });
      return;
    }
    const id = ctx.db.normalizeId('knowledge', args.targetId);
    if (id === null) return;
    const doc = await ctx.db.get(id);
    if (doc === null || doc.userId !== args.userId) return;
    await ctx.db.patch(id, { embedding: args.embedding, embeddingVersion: args.embeddingVersion });
  },
});

export type StaleRow = { targetType: 'entry' | 'knowledge'; targetId: string; userId: Id<'users'> };

/**
 * Rows whose embeddingVersion is missing or stale, up to `limit`, for the backfill
 * cron (convex/crons.ts). Full table scans over entries/knowledge filtered in code
 * — fine at this scale (single-digit users, low row counts, hourly cadence); an
 * index on embeddingVersion is the obvious upgrade if this ever shows up in
 * profiling (mirrors aiRuns.spentToday's identical scale note).
 */
export const scanStale = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<StaleRow[]> => {
    const stale: StaleRow[] = [];

    const entries = await ctx.db.query('entries').collect();
    for (const entry of entries) {
      if (stale.length >= args.limit) return stale;
      if (entry.embeddingVersion !== EMBED_VERSION) {
        stale.push({ targetType: 'entry', targetId: entry._id, userId: entry.userId });
      }
    }

    const knowledgeRows = await ctx.db.query('knowledge').collect();
    for (const knowledge of knowledgeRows) {
      if (stale.length >= args.limit) return stale;
      if (knowledge.embeddingVersion !== EMBED_VERSION) {
        stale.push({ targetType: 'knowledge', targetId: knowledge._id, userId: knowledge.userId });
      }
    }

    return stale;
  },
});
