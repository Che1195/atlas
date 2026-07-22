// Confidence computation (docs/spec/03-domain-model.md §5). Pure — no ctx, no Date.now().
// The AI never sets confidence; this function is the only writer of the suggestion.
// Distinct-source counting enforces "repeated summaries are not additional evidence":
// entry sources collapse through duplicateOf chains; outcomes count double-weight
// (real-world tests beat recollections). Neutral stance affects neither count.

import type { Stance } from '../shared/proposalOps';

export type Confidence =
  | 'hypothesis'
  | 'tentative'
  | 'supported'
  | 'strong'
  | 'mixed'
  | 'contradicted';

export type EvidenceSource = {
  sourceType: 'entry' | 'outcome';
  sourceId: string;
  stance: Stance;
};

export type ConfidenceComputation = {
  suggested: Confidence;
  supports: number;
  contradicts: number;
};

/**
 * Resolve an entry id through duplicateOf links to its root (cycle-safe).
 * On a cycle, all members of the cycle must resolve to the same canonical id
 * regardless of which member we start from — otherwise duplicates in a cycle
 * would fail to collapse. We deterministically pick the lexicographically
 * smallest id among the cycle's members as that shared representative.
 */
function canonicalId(id: string, duplicateOf: Record<string, string>): string {
  let current = id;
  const seen: string[] = [];
  for (;;) {
    const next = duplicateOf[current];
    if (next === undefined || seen.includes(current)) break;
    seen.push(current);
    current = next;
  }
  const cycleStart = seen.indexOf(current);
  if (cycleStart === -1) return current; // terminal (non-cyclic) root
  const cycle = seen.slice(cycleStart);
  return cycle.reduce((min, x) => (x < min ? x : min));
}

export function computeConfidence(
  evidence: EvidenceSource[],
  duplicateOf: Record<string, string>,
): ConfidenceComputation {
  const weights = new Map<string, number>(); // canonical source key -> weight
  const stances = new Map<string, Stance>();
  for (const source of evidence) {
    if (source.stance === 'neutral') continue;
    const canonical =
      source.sourceType === 'entry'
        ? `entry:${canonicalId(source.sourceId, duplicateOf)}`
        : `outcome:${source.sourceId}`;
    weights.set(canonical, source.sourceType === 'outcome' ? 2 : 1);
    stances.set(canonical, source.stance);
  }

  let supports = 0;
  let contradicts = 0;
  for (const [key, stance] of stances) {
    const weight = weights.get(key) ?? 1;
    if (stance === 'supports') supports += weight;
    else contradicts += stance === 'contradicts' ? 1 : 0; // contradicting sources are not double-weighted
  }

  let suggested: Confidence;
  if (contradicts === 0) {
    if (supports === 0) suggested = 'hypothesis';
    else if (supports === 1) suggested = 'tentative';
    else if (supports <= 3) suggested = 'supported';
    else suggested = 'strong';
  } else if (contradicts >= 2 && contradicts > supports) {
    suggested = 'contradicted';
  } else if (supports > 2 * contradicts) {
    suggested = 'supported';
  } else {
    suggested = 'mixed';
  }

  return { suggested, supports, contradicts };
}
