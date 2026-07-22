// Confidence matrix per docs/spec/03-domain-model.md §5.
import { describe, expect, it } from 'vitest';
import { computeConfidence, type EvidenceSource } from '../convex/lib/confidence';

const entry = (id: string, stance: EvidenceSource['stance'] = 'supports'): EvidenceSource => ({
  sourceType: 'entry',
  sourceId: id,
  stance,
});
const outcome = (id: string, stance: EvidenceSource['stance'] = 'supports'): EvidenceSource => ({
  sourceType: 'outcome',
  sourceId: id,
  stance,
});

describe('computeConfidence', () => {
  it('no evidence → hypothesis', () => {
    expect(computeConfidence([], {})).toEqual({ suggested: 'hypothesis', supports: 0, contradicts: 0 });
  });
  it('C=0 ladder: 1→tentative, 2-3→supported, 4+→strong', () => {
    expect(computeConfidence([entry('e1')], {}).suggested).toBe('tentative');
    expect(computeConfidence([entry('e1'), entry('e2')], {}).suggested).toBe('supported');
    expect(computeConfidence([entry('e1'), entry('e2'), entry('e3')], {}).suggested).toBe('supported');
    expect(
      computeConfidence([entry('e1'), entry('e2'), entry('e3'), entry('e4')], {}).suggested,
    ).toBe('strong');
  });
  it('outcomes count double-weight on the supporting side', () => {
    const c = computeConfidence([outcome('o1')], {});
    expect(c).toEqual({ suggested: 'supported', supports: 2, contradicts: 0 });
  });
  it('S > 2C → supported (mixed-leaning-supported)', () => {
    const c = computeConfidence(
      [entry('e1'), entry('e2'), entry('e3'), entry('x', 'contradicts')],
      {},
    );
    expect(c).toEqual({ suggested: 'supported', supports: 3, contradicts: 1 });
  });
  it('C>0 and S <= 2C → mixed', () => {
    expect(computeConfidence([entry('x', 'contradicts')], {}).suggested).toBe('mixed');
    expect(
      computeConfidence(
        [entry('e1'), entry('e2'), entry('e3'), entry('e4'), entry('x', 'contradicts'), entry('y', 'contradicts')],
        {},
      ).suggested,
    ).toBe('mixed'); // S=4, C=2, S <= 2C
  });
  it('C>=2 and C>S → contradicted', () => {
    expect(
      computeConfidence([entry('e1'), entry('x', 'contradicts'), entry('y', 'contradicts')], {})
        .suggested,
    ).toBe('contradicted');
  });
  it('duplicateOf chains collapse to one distinct source', () => {
    const c = computeConfidence([entry('e1'), entry('e2')], { e2: 'e1' });
    expect(c).toEqual({ suggested: 'tentative', supports: 1, contradicts: 0 });
    // chain e3 → e2 → e1
    expect(
      computeConfidence([entry('e1'), entry('e2'), entry('e3')], { e3: 'e2', e2: 'e1' }).supports,
    ).toBe(1);
  });
  it('duplicateOf cycles do not hang', () => {
    expect(computeConfidence([entry('e1'), entry('e2')], { e1: 'e2', e2: 'e1' }).supports).toBe(1);
  });
  it('neutral stance is ignored in both counts', () => {
    const c = computeConfidence([entry('e1'), entry('n', 'neutral')], {});
    expect(c).toEqual({ suggested: 'tentative', supports: 1, contradicts: 0 });
  });
});
