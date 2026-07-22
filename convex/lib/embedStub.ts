// Deterministic dev/test embedding stub (Phase M Task 3, docs/spec/05-ai-pipeline.md
// §1 "embed"; plan Global Constraints — "convex-test and E2E never hit the network").
// PURE — no ctx, no randomness beyond a seeded hash of the input text, so the same
// text always produces the same vector and different text (almost certainly)
// produces a different one. This is NOT a real embedding (no semantic meaning) —
// it exists purely so hybrid-search and re-embed plumbing can be exercised without
// OPENAI_API_KEY.

/** FNV-1a 32-bit hash — cheap, deterministic, good-enough avalanche for seeding. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — a small, fast, seeded PRNG producing floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic, unit-normalized embedding for `text`: same text -> byte-identical
 * vector; different text -> (in practice) a different vector; length `dimensions`;
 * Euclidean norm 1 (within floating-point rounding).
 */
export function embedStub(text: string, dimensions: number): number[] {
  const seed = fnv1a(text);
  const random = mulberry32(seed);
  const raw: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    raw.push(random() * 2 - 1); // spread into [-1, 1) rather than clustering at [0, 1)
  }
  let normSquared = 0;
  for (const value of raw) normSquared += value * value;
  const norm = Math.sqrt(normSquared);
  // norm is 0 only if every component is exactly 0, which mulberry32 never emits
  // for a real 1024-length draw — no zero-vector guard needed in practice, but
  // guard anyway so a pathological seed can't divide by zero.
  if (norm === 0) return raw.map(() => 0);
  return raw.map((value) => value / norm);
}
