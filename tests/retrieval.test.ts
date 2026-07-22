// TDD for the pure RRF fusion lib (Phase M Task 3, docs/spec/05-ai-pipeline.md §1
// "ask"). No convex-test needed — mergeRanked takes no ctx.
import { describe, expect, it } from 'vitest';
import { mergeRanked } from '../convex/lib/retrieval';

describe('mergeRanked (reciprocal rank fusion, k=60)', () => {
  it('both sources non-empty: an id ranked well in both sources outranks one backed by a single source', () => {
    const vectorHits = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.5 },
    ];
    const textHits = [
      { id: 'b', rank: 1 },
      { id: 'c', rank: 2 },
    ];
    const result = mergeRanked(vectorHits, textHits, 10);
    expect(result.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    // b: vector rank2 (1/62) + text rank1 (1/61); a: vector rank1 only (1/61); c: text rank2 only (1/62)
    expect(result[0]).toEqual({ id: 'b', score: 1 / 62 + 1 / 61 });
    expect(result[1]).toEqual({ id: 'a', score: 1 / 61 });
    expect(result[2]).toEqual({ id: 'c', score: 1 / 62 });
  });

  it('one source empty (text): falls back to vector-only ranking, order preserved', () => {
    const vectorHits = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.5 },
      { id: 'c', score: 0.1 },
    ];
    const result = mergeRanked(vectorHits, [], 10);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('one source empty (vector): falls back to text-only ranking, order preserved', () => {
    const textHits = [
      { id: 'x', rank: 1 },
      { id: 'y', rank: 2 },
    ];
    const result = mergeRanked([], textHits, 10);
    expect(result.map((r) => r.id)).toEqual(['x', 'y']);
  });

  it('both sources empty: returns an empty list', () => {
    expect(mergeRanked([], [], 10)).toEqual([]);
  });

  it('dedupes: an id present in both sources appears exactly once in the output', () => {
    const vectorHits = [{ id: 'shared', score: 0.9 }];
    const textHits = [{ id: 'shared', rank: 1 }];
    const result = mergeRanked(vectorHits, textHits, 10);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('shared');
  });

  it('deterministic tiebreak: equal fused scores sort by ascending id, not insertion order', () => {
    // Both 'b' (vector rank 1) and 'a' (text rank 1) score exactly 1/61 — a tie.
    const vectorHits = [{ id: 'b', score: 0.5 }];
    const textHits = [{ id: 'a', rank: 1 }];
    const result = mergeRanked(vectorHits, textHits, 10);
    expect(result[0]?.score).toBe(result[1]?.score);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('respects the limit, keeping the highest-fused-score items', () => {
    const vectorHits = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
      { id: 'c', score: 0.7 },
    ];
    const result = mergeRanked(vectorHits, [], 2);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
