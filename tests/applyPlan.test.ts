// TDD matrix for applyPlan.ts (Phase 3a Task 3, AC-3.3). Pure planning: no ctx, no ids.

import { describe, expect, it } from 'vitest';
import { planApplication, type OpResolution } from '../convex/lib/applyPlan';
import type { ProposalOp } from '../convex/shared/proposalOps';

const createOp = (statement: string): ProposalOp => ({
  op: 'createKnowledge',
  type: 'insight',
  statement,
});

const evidenceRefNew = (index: number): ProposalOp => ({
  op: 'addEvidence',
  knowledge: { kind: 'new', index },
  sourceType: 'entry',
  sourceId: 'entry_1',
  stance: 'supports',
});

describe('planApplication', () => {
  it('applies all ops when all are approved', () => {
    const ops: ProposalOp[] = [createOp('A'), evidenceRefNew(0)];
    const resolutions: OpResolution[] = ['approved', 'approved'];
    const editedOps: Array<ProposalOp | null> = [null, null];

    const result = planApplication(ops, resolutions, editedOps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.toApply).toEqual([
      { index: 0, op: ops[0] },
      { index: 1, op: ops[1] },
    ]);
    expect(result.newIndexMap).toEqual(new Map([[0, 0]]));
  });

  it('applies nothing when all are rejected (ok, empty toApply)', () => {
    const ops: ProposalOp[] = [createOp('A'), evidenceRefNew(0)];
    const resolutions: OpResolution[] = ['rejected', 'rejected'];
    const editedOps: Array<ProposalOp | null> = [null, null];

    const result = planApplication(ops, resolutions, editedOps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.toApply).toEqual([]);
    expect(result.newIndexMap).toEqual(new Map());
  });

  it('replaces the original op with the edited op when resolution is edited', () => {
    const ops: ProposalOp[] = [createOp('original statement')];
    const resolutions: OpResolution[] = ['edited'];
    const edited: ProposalOp = createOp('edited statement');
    const editedOps: Array<ProposalOp | null> = [edited];

    const result = planApplication(ops, resolutions, editedOps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.toApply).toEqual([{ index: 0, op: edited }]);
    expect(result.toApply[0]?.op).not.toBe(ops[0]);
    expect(result.newIndexMap).toEqual(new Map([[0, 0]]));
  });

  it('refuses an approved op whose new-ref targets a rejected createKnowledge (AC-3.3)', () => {
    const ops: ProposalOp[] = [createOp('will be rejected'), evidenceRefNew(0)];
    const resolutions: OpResolution[] = ['rejected', 'approved'];
    const editedOps: Array<ProposalOp | null> = [null, null];

    const result = planApplication(ops, resolutions, editedOps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failedIndex).toBe(1);
    // Error must name the dependency: the creation ordinal it points at.
    expect(result.error).toContain('0');
  });

  it('resolves a new-ref to an approved creation through newIndexMap when an earlier creation was rejected (index shifting)', () => {
    const ops: ProposalOp[] = [createOp('rejected creation'), createOp('approved creation'), evidenceRefNew(1)];
    const resolutions: OpResolution[] = ['rejected', 'approved', 'approved'];
    const editedOps: Array<ProposalOp | null> = [null, null, null];

    const result = planApplication(ops, resolutions, editedOps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Creation ordinal 0 was rejected and is absent from the map.
    expect(result.newIndexMap.has(0)).toBe(false);
    // Creation ordinal 1 (the only applied creation) becomes applied position 0.
    expect(result.newIndexMap).toEqual(new Map([[1, 0]]));
    expect(result.toApply).toEqual([
      { index: 1, op: ops[1] },
      { index: 2, op: ops[2] },
    ]);
  });

  it('throws on length mismatch between ops, resolutions, and editedOps', () => {
    const ops: ProposalOp[] = [createOp('A'), createOp('B')];
    expect(() => planApplication(ops, ['approved'], [null, null])).toThrow();
    expect(() => planApplication(ops, ['approved', 'approved'], [null])).toThrow();
  });

  it('throws when a resolution is edited but the corresponding editedOp is null', () => {
    const ops: ProposalOp[] = [createOp('A')];
    expect(() => planApplication(ops, ['edited'], [null])).toThrow();
  });
});
