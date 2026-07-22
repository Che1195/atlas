// The stub provider's output must satisfy the proposal-op contract — E2E in Phase 3
// tests the loop, not the model (docs/spec/11-testing-strategy.md §3).
import { describe, expect, it } from 'vitest';
import { getProviderKind, stubDistillation } from '../convex/ai/provider';
import { validateOps } from '../convex/shared/proposalOps';

describe('ai provider flag', () => {
  it('selects stub only when AI_PROVIDER=stub', () => {
    expect(getProviderKind({ AI_PROVIDER: 'stub' })).toBe('stub');
    expect(getProviderKind({ AI_PROVIDER: 'live' })).toBe('live');
    expect(getProviderKind({})).toBe('live');
  });

  it('stub distillation output passes the op validator', () => {
    const result = stubDistillation('I noticed I interrupt people when nervous.');
    const verdicts = validateOps(result.ops);
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => v.valid)).toBe(true);
    expect(result.rationale.length).toBeGreaterThan(0);
    expect(result.citations).toEqual([{ excerpt: 'I noticed I interrupt people when nervous.' }]);
  });

  it("body exactly 'skip' produces an empty, valid ops array (trivial-empty path)", () => {
    const result = stubDistillation('skip');
    expect(result).toEqual({ ops: [], rationale: 'nothing to propose', citations: [] });
    expect(validateOps(result.ops)).toEqual([]);
  });
});
