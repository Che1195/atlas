// Hybrid retrieval fusion (Phase M Task 3, docs/spec/05-ai-pipeline.md §1 "ask" —
// "merged/ranked in lib/retrieval.ts"). PURE — no ctx, no I/O — so the vector and
// text search calls (which live in different runtimes: vector search is action-
// only) can each independently produce a rank list and hand it to this one place
// to combine.
//
// Reciprocal Rank Fusion (k=60, the standard default from the original RRF paper):
// each hit contributes 1/(k + rank) from every source it appears in; an id present
// in both sources sums both contributions, so it naturally outranks an id backed
// by only one signal. Ties (e.g. two ids each rank-1 in their own single source)
// break deterministically by ascending id — never insertion order — so results are
// stable across runs/languages/environments.

const RRF_K = 60;

export type VectorHit = { id: string; score: number };
export type TextHit = { id: string; rank: number };
export type FusedHit = { id: string; score: number };

/**
 * Fuse a vector-search hit list (assumed pre-sorted best-first by `score`, per
 * `ctx.vectorSearch`'s contract — rank is derived from array position) with a
 * full-text hit list (rank supplied explicitly, since Convex search indexes don't
 * expose a numeric relevance score) into one ranked, deduped list of at most
 * `limit` ids.
 */
export function mergeRanked(vectorHits: VectorHit[], textHits: TextHit[], limit: number): FusedHit[] {
  const scores = new Map<string, number>();

  vectorHits.forEach((hit, index) => {
    const rank = index + 1;
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (RRF_K + rank));
  });

  for (const hit of textHits) {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (RRF_K + hit.rank));
  }

  return Array.from(scores, ([id, score]) => ({ id, score }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)))
    .slice(0, limit);
}
