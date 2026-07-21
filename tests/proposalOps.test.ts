import { describe, expect, it } from 'vitest';
import {
  STATEMENT_MAX_LENGTH,
  allOpsValid,
  validateOps,
  type ProposalOp,
} from '../convex/shared/proposalOps';

const create = (statement = 'I become performative around perceived-higher-status people.') =>
  ({ op: 'createKnowledge', type: 'insight', statement }) satisfies ProposalOp;

describe('validateOps', () => {
  it('accepts a well-formed multi-op proposal with new-refs', () => {
    const ops: ProposalOp[] = [
      create(),
      {
        op: 'addEvidence',
        knowledge: { kind: 'new', index: 0 },
        sourceType: 'entry',
        sourceId: 'entry_123',
        stance: 'supports',
        note: 'Muay Thai class reflection',
      },
      {
        op: 'createRelationship',
        from: { kind: 'new', index: 0 },
        to: { kind: 'existing', id: 'kn_456' },
        kind: 'relates-to',
      },
    ];
    expect(validateOps(ops)).toEqual([{ valid: true }, { valid: true }, { valid: true }]);
    expect(allOpsValid(ops)).toBe(true);
  });

  it('rejects non-array and empty inputs', () => {
    expect(validateOps('nope')[0]).toMatchObject({ valid: false });
    expect(allOpsValid([])).toBe(false);
  });

  it('rejects unknown op kinds', () => {
    const [verdict] = validateOps([{ op: 'setConfidence', value: 'strong' }]);
    expect(verdict).toMatchObject({ valid: false, error: expect.stringContaining('unknown op') });
  });

  it('rejects unknown keys (allowlist discipline)', () => {
    const [verdict] = validateOps([{ ...create(), confidence: 'strong' }]);
    expect(verdict).toMatchObject({
      valid: false,
      error: expect.stringContaining('unknown key'),
    });
  });

  it('enforces statement length and presence', () => {
    expect(validateOps([create('')])[0]?.valid).toBe(false);
    expect(validateOps([create('x'.repeat(STATEMENT_MAX_LENGTH + 1))])[0]?.valid).toBe(false);
    expect(validateOps([create('x'.repeat(STATEMENT_MAX_LENGTH))])[0]?.valid).toBe(true);
  });

  it('rejects forward and out-of-range new-refs', () => {
    // new-ref before any createKnowledge op
    const forward = validateOps([
      {
        op: 'addEvidence',
        knowledge: { kind: 'new', index: 0 },
        sourceType: 'entry',
        sourceId: 'e1',
        stance: 'supports',
      },
      create(),
    ]);
    expect(forward[0]?.valid).toBe(false);
    expect(forward[1]?.valid).toBe(true);

    const outOfRange = validateOps([
      create(),
      { op: 'archiveKnowledge', target: { kind: 'new', index: 3 }, reason: 'superseded' },
    ]);
    expect(outOfRange[1]?.valid).toBe(false);
  });

  it('requires reasons on update and archive', () => {
    const ops = [
      { op: 'updateKnowledge', target: { kind: 'existing', id: 'kn_1' }, patch: { body: 'x' }, reason: '' },
      { op: 'archiveKnowledge', target: { kind: 'existing', id: 'kn_1' }, reason: '  ' },
    ];
    expect(validateOps(ops).every((verdict) => !verdict.valid)).toBe(true);
  });

  it('rejects empty and unknown-key patches', () => {
    const empty = validateOps([
      { op: 'updateKnowledge', target: { kind: 'existing', id: 'kn_1' }, patch: {}, reason: 'r' },
    ]);
    expect(empty[0]?.valid).toBe(false);

    const sneaky = validateOps([
      {
        op: 'updateKnowledge',
        target: { kind: 'existing', id: 'kn_1' },
        patch: { confidence: 'strong' },
        reason: 'r',
      },
    ]);
    expect(sneaky[0]).toMatchObject({ valid: false, error: expect.stringContaining('patch') });
  });

  it('rejects self-referencing relationships', () => {
    const [verdict] = validateOps([
      {
        op: 'createRelationship',
        from: { kind: 'existing', id: 'kn_1' },
        to: { kind: 'existing', id: 'kn_1' },
        kind: 'contradicts',
      },
    ]);
    expect(verdict?.valid).toBe(false);
  });

  it('requires all six experiment fields', () => {
    const [verdict] = validateOps([
      {
        op: 'createExperiment',
        knowledge: { kind: 'existing', id: 'kn_1' },
        hypothesis: 'h',
        behavior: 'b',
        context: 'c',
        successCriteria: 's',
        failureCriteria: 'f',
        observationTarget: '',
      },
    ]);
    expect(verdict).toMatchObject({
      valid: false,
      error: expect.stringContaining('observationTarget'),
    });
  });

  it('has no op that can set confidence (AC-5.4)', () => {
    // Structural guarantee: every op kind rejects a confidence key.
    const attempts = [
      { ...create(), confidence: 'strong' },
      {
        op: 'updateKnowledge',
        target: { kind: 'existing', id: 'kn_1' },
        patch: { statement: 'ok' },
        reason: 'r',
        confidence: 'strong',
      },
    ];
    for (const attempt of attempts) {
      expect(validateOps([attempt])[0]?.valid).toBe(false);
    }
  });
});
