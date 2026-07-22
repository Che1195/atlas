import { describe, expect, it } from 'vitest';
import {
  MCP_PROPOSAL_OPS_JSON_SCHEMA,
  OP_KEYS,
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

// Fix (post-Task-4-review): MCP's propose tools embed MCP_PROPOSAL_OPS_JSON_SCHEMA
// (not distill's OpenAI-structured-outputs-constrained PROPOSAL_OPS_JSON_SCHEMA).
// This asserts that schema mirrors OP_KEYS/checkOp's allowlists exactly — all six
// kinds, optional fields genuinely optional (absent from `required`, never a
// null-union), so a schema-honoring client never emits a `null` that validateOps
// then rejects.
describe('MCP_PROPOSAL_OPS_JSON_SCHEMA', () => {
  type JsonSchemaObject = {
    type: 'object';
    properties: Record<string, unknown>;
    required?: readonly string[];
  };

  function schemaByOpConst(): Record<string, JsonSchemaObject> {
    const byOp: Record<string, JsonSchemaObject> = {};
    for (const item of MCP_PROPOSAL_OPS_JSON_SCHEMA.items.anyOf) {
      const opConst = (item.properties.op as { const: string }).const;
      byOp[opConst] = item as JsonSchemaObject;
    }
    return byOp;
  }

  it('represents exactly the six op kinds from OP_KEYS', () => {
    const byOp = schemaByOpConst();
    expect(Object.keys(byOp).sort()).toEqual(Object.keys(OP_KEYS).sort());
  });

  it('every op schema\'s property keys match OP_KEYS exactly (no drift)', () => {
    const byOp = schemaByOpConst();
    for (const [op, keys] of Object.entries(OP_KEYS)) {
      const schema = byOp[op];
      expect(schema, `missing MCP schema for ${op}`).toBeDefined();
      expect(Object.keys(schema!.properties).sort()).toEqual([...keys].sort());
    }
  });

  it('optional fields (body, note) are absent from `required`, not null-unioned', () => {
    const byOp = schemaByOpConst();

    const createKnowledge = byOp.createKnowledge!;
    expect(createKnowledge.required).toEqual(['op', 'type', 'statement']);
    expect(createKnowledge.properties.body).toEqual({ type: 'string' });

    const addEvidence = byOp.addEvidence!;
    expect(addEvidence.required).toEqual(['op', 'knowledge', 'sourceType', 'sourceId', 'stance']);
    expect(addEvidence.properties.note).toEqual({ type: 'string' });
    // Full enum, not narrowed to a const 'entry' the way distill's schema is.
    expect(addEvidence.properties.sourceType).toEqual({ enum: ['entry', 'outcome'] });

    const createRelationship = byOp.createRelationship!;
    expect(createRelationship.required).toEqual(['op', 'from', 'to', 'kind']);
    expect(createRelationship.properties.note).toEqual({ type: 'string' });

    const updateKnowledge = byOp.updateKnowledge!;
    const patch = updateKnowledge.properties.patch as { required?: readonly string[] };
    expect(patch.required).toBeUndefined();
  });

  it('never uses a { type: "null" } union anywhere (MCP clients are not structured-outputs constrained)', () => {
    const seen: unknown[] = [];
    const stack: unknown[] = [MCP_PROPOSAL_OPS_JSON_SCHEMA];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === null || typeof node !== 'object') continue;
      if (seen.includes(node)) continue;
      seen.push(node);
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      const record = node as Record<string, unknown>;
      if (record.type === 'null') throw new Error('found a { type: "null" } union in MCP_PROPOSAL_OPS_JSON_SCHEMA');
      stack.push(...Object.values(record));
    }
  });

  it('includes archiveKnowledge, createRelationship, and createExperiment (out of scope for distill, in scope for MCP)', () => {
    const byOp = schemaByOpConst();
    expect(byOp.archiveKnowledge).toBeDefined();
    expect(byOp.createRelationship).toBeDefined();
    expect(byOp.createExperiment).toBeDefined();
  });
});
