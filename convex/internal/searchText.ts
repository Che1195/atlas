// Full-text half of hybrid retrieval (Phase M Task 3, docs/spec/05-ai-pipeline.md
// §1 "ask" / plan's vector-search-in-actions design note). Internal only (08 §2):
// explicit userId, no isolation row needed (registry only covers public functions).
//
// Convex vector search runs in ACTIONS ONLY, while search indexes (like every other
// query) run in QUERIES — so the seam is: this file (queries — text search +
// minimal-row hydration) is called via ctx.runQuery from convex/ai/search.ts (an
// action, which does the vectorSearch half itself and fuses both with
// lib/retrieval's mergeRanked).
import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

/** Rank is the search index's own relevance order (1-based); Convex doesn't expose
 * a numeric text-relevance score, only ordering — mergeRanked (lib/retrieval.ts)
 * is built to consume exactly this shape. */
export type TextRank = { id: string; rank: number };

export const searchKnowledge = internalQuery({
  args: { userId: v.id('users'), query: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<TextRank[]> => {
    if (args.query.trim() === '') return [];
    const rows = await ctx.db
      .query('knowledge')
      .withSearchIndex('search_statement', (q) =>
        q.search('statement', args.query).eq('userId', args.userId),
      )
      .take(args.limit);
    return rows.map((row, index) => ({ id: row._id, rank: index + 1 }));
  },
});

export const searchEntries = internalQuery({
  args: { userId: v.id('users'), query: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<TextRank[]> => {
    if (args.query.trim() === '') return [];
    const rows = await ctx.db
      .query('entries')
      .withSearchIndex('search_body', (q) => q.search('body', args.query).eq('userId', args.userId))
      .take(args.limit);
    return rows.map((row, index) => ({ id: row._id, rank: index + 1 }));
  },
});

export type KnowledgeHitRow = {
  id: string;
  type: string;
  statement: string;
  confidence: string;
};

/** Minimal knowledge rows for fused ids, re-scoped to `userId` (an id from a stale
 * or cross-user fused list is silently dropped rather than leaking). */
export const hydrateKnowledge = internalQuery({
  args: { userId: v.id('users'), ids: v.array(v.string()) },
  handler: async (ctx, args): Promise<KnowledgeHitRow[]> => {
    const rows: KnowledgeHitRow[] = [];
    for (const idStr of args.ids) {
      const id = ctx.db.normalizeId('knowledge', idStr);
      const doc = id === null ? null : await ctx.db.get(id);
      if (doc === null || doc.userId !== args.userId) continue;
      rows.push({ id: doc._id, type: doc.type, statement: doc.statement, confidence: doc.confidence });
    }
    return rows;
  },
});

export type EntryHitRow = {
  id: string;
  title: string | undefined;
  excerpt: string;
  occurredAt: number;
};

/** Minimal entry rows for fused ids, re-scoped to `userId` (same drop-not-leak rule
 * as hydrateKnowledge). */
export const hydrateEntries = internalQuery({
  args: { userId: v.id('users'), ids: v.array(v.string()) },
  handler: async (ctx, args): Promise<EntryHitRow[]> => {
    const rows: EntryHitRow[] = [];
    for (const idStr of args.ids) {
      const id = ctx.db.normalizeId('entries', idStr);
      const doc = id === null ? null : await ctx.db.get(id);
      if (doc === null || doc.userId !== args.userId) continue;
      rows.push({ id: doc._id, title: doc.title, excerpt: doc.body.slice(0, 140), occurredAt: doc.occurredAt });
    }
    return rows;
  },
});
