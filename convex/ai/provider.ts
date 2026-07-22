// AI provider selection (docs/spec/11-testing-strategy.md §3): a dev-only env flag
// routes ai/* actions to a fixture provider so E2E tests the loop, not the model.
// Phase 3's distill/connect actions consume this; only the flag + one fixture exist now.

export function getProviderKind(env: Record<string, string | undefined>): 'stub' | 'live' {
  return env.AI_PROVIDER === 'stub' ? 'stub' : 'live';
}

/**
 * Canned distillation: one conservative observation with the entry as evidence-to-be.
 * Body exactly 'skip' is the test/E2E trivial-empty path (AC-3.1's "nothing worth
 * proposing") — returns an empty ops array instead of the canned observation.
 */
export function stubDistillation(entryBody: string): {
  ops: unknown[];
  rationale: string;
  citations: { excerpt: string }[];
} {
  if (entryBody === 'skip') {
    return { ops: [], rationale: 'nothing to propose', citations: [] };
  }
  const excerpt = entryBody.slice(0, 80);
  return {
    ops: [
      {
        op: 'createKnowledge',
        type: 'observation',
        statement: `I noticed: ${excerpt}`.slice(0, 280),
      },
    ],
    rationale: 'Stub provider: one conservative observation from the entry opening.',
    citations: [{ excerpt: entryBody.slice(0, 60) }],
  };
}
