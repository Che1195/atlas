"use node";

// Hybrid search (Phase M Task 3, docs/spec/05-ai-pipeline.md §1 "ask"; plan's
// vector-search-in-actions design note). Convex vector search runs in ACTIONS
// ONLY, so this action does the vector half itself (ctx.vectorSearch) and calls
// convex/internal/searchText.ts (a query) for the full-text half, then fuses both
// with lib/retrieval's mergeRanked (RRF, k=60) before hydrating minimal rows.
//
// This is Task 4's dependency (MCP `atlas_search_knowledge` / `atlas_retrieve_context`
// and, later, in-app search): the exported name is `hybridSearch`, args and result
// shapes below are the seam — keep them stable.
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { embedStub } from '../lib/embedStub';
import { mergeRanked, type TextHit, type VectorHit } from '../lib/retrieval';
import { EMBED_DIMENSIONS, EMBED_MODEL } from './models';
import { getProviderKind } from './provider';

const scopeValidator = v.union(v.literal('knowledge'), v.literal('entries'), v.literal('both'));
export type SearchScope = 'knowledge' | 'entries' | 'both';

export type KnowledgeSearchHit = {
  objectType: 'knowledge';
  id: string;
  type: string;
  statement: string;
  confidence: string;
  score: number;
};

export type EntrySearchHit = {
  objectType: 'entry';
  id: string;
  title: string | undefined;
  excerpt: string;
  occurredAt: number;
  score: number;
};

export type SearchHit = KnowledgeSearchHit | EntrySearchHit;

const DEFAULT_LIMIT = 20;

/**
 * Runs a vector-search thunk, treating ANY failure as "no vector signal" rather
 * than an error — 05 §5: "search falls back to full-text-only when a row's
 * embedding is missing" (this also covers the edge case of a vector index with
 * no populated rows yet, e.g. a brand-new user before their first embed lands).
 */
async function safeVectorHits(run: () => Promise<VectorHit[]>): Promise<VectorHit[]> {
  try {
    return await run();
  } catch (error) {
    console.error('vectorSearch failed, degrading to text-only', error);
    return [];
  }
}

/**
 * Embed the query the SAME way stored rows are embedded (05 §1 — "same embedding
 * call for stored texts and search-time queries"). Returns null when the query
 * can't be embedded — either the live path with no OPENAI_API_KEY configured (a
 * silent, expected degrade-to-text-only), or a thrown provider error on the live
 * call (an unexpected failure, logged via console.error so it's observable in
 * Convex logs, but STILL degrades to text-only rather than failing the whole
 * search — 05 §5's "search falls back to full-text-only when a row's embedding
 * is missing" extends naturally to "...or the query itself couldn't be embedded").
 */
async function embedQuery(query: string): Promise<number[] | null> {
  if (getProviderKind(process.env) === 'stub') {
    return embedStub(query, EMBED_DIMENSIONS);
  }
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI();
    const response = await client.embeddings.create({
      model: EMBED_MODEL,
      input: query,
      dimensions: EMBED_DIMENSIONS,
    });
    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('query embedding failed, degrading to text-only', error);
    return null;
  }
}

export const hybridSearch = internalAction({
  args: {
    userId: v.id('users'),
    query: v.string(),
    limit: v.optional(v.number()),
    scope: scopeValidator,
  },
  handler: async (ctx, args): Promise<SearchHit[]> => {
    const limit = args.limit ?? DEFAULT_LIMIT;
    const queryVector = await embedQuery(args.query);

    const wantKnowledge = args.scope === 'knowledge' || args.scope === 'both';
    const wantEntries = args.scope === 'entries' || args.scope === 'both';

    const hits: SearchHit[] = [];

    if (wantKnowledge) {
      const vectorHits: VectorHit[] = queryVector
        ? await safeVectorHits(async () =>
            (
              await ctx.vectorSearch('knowledge', 'by_embedding', {
                vector: queryVector,
                limit,
                filter: (q) => q.eq('userId', args.userId),
              })
            ).map((r) => ({ id: r._id as string, score: r._score })),
          )
        : [];
      const textHits: TextHit[] = await ctx.runQuery(internal.internal.searchText.searchKnowledge, {
        userId: args.userId,
        query: args.query,
        limit,
      });
      const fused = mergeRanked(vectorHits, textHits, limit);
      const rows = await ctx.runQuery(internal.internal.searchText.hydrateKnowledge, {
        userId: args.userId,
        ids: fused.map((f) => f.id),
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const f of fused) {
        const row = byId.get(f.id);
        if (row === undefined) continue;
        hits.push({
          objectType: 'knowledge',
          id: row.id,
          type: row.type,
          statement: row.statement,
          confidence: row.confidence,
          score: f.score,
        });
      }
    }

    if (wantEntries) {
      const vectorHits: VectorHit[] = queryVector
        ? await safeVectorHits(async () =>
            (
              await ctx.vectorSearch('entries', 'by_embedding', {
                vector: queryVector,
                limit,
                filter: (q) => q.eq('userId', args.userId),
              })
            ).map((r) => ({ id: r._id as string, score: r._score })),
          )
        : [];
      const textHits: TextHit[] = await ctx.runQuery(internal.internal.searchText.searchEntries, {
        userId: args.userId,
        query: args.query,
        limit,
      });
      const fused = mergeRanked(vectorHits, textHits, limit);
      const rows = await ctx.runQuery(internal.internal.searchText.hydrateEntries, {
        userId: args.userId,
        ids: fused.map((f) => f.id),
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const f of fused) {
        const row = byId.get(f.id);
        if (row === undefined) continue;
        hits.push({
          objectType: 'entry',
          id: row.id,
          title: row.title,
          excerpt: row.excerpt,
          occurredAt: row.occurredAt,
          score: f.score,
        });
      }
    }

    // scope: 'both' merges two independently-fused-and-capped lists — re-sort and
    // cap once more so the combined result still respects `limit`. Deterministic
    // tiebreak by ascending id (mirrors lib/retrieval.mergeRanked) so equal-score
    // cross-kind ties don't depend on insertion order.
    return hits
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)))
      .slice(0, limit);
  },
});
