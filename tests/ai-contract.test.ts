import { describe, expect, it } from 'vitest';
import { DISTILL_MODEL } from '../convex/ai/models';
import { DISTILL_PROMPT_VERSION, buildDistillPrompt } from '../convex/ai/prompts/distill';
import { PROPOSAL_OPS_JSON_SCHEMA, validateOps } from '../convex/shared/proposalOps';

describe('ai contract', () => {
  it('model id is the spec-mandated distillation model', () => {
    expect(DISTILL_MODEL).toBe('claude-sonnet-5');
  });
  it('prompt embeds the conservatism contract and the context', () => {
    const p = buildDistillPrompt({
      entryBody: 'Backed down again in the meeting.',
      entryKind: 'journal',
      occurredAt: '2026-07-22',
      knowledgeContext: [{ id: 'k1', type: 'insight', statement: 'I avoid conflict.', confidence: 'tentative' }],
    });
    for (const needle of ['0', '4', 'addEvidence', 'never', 'confidence', 'I avoid conflict.', 'Backed down again']) {
      expect(p.system + p.user).toContain(needle);
    }
    expect(p.system).toContain(DISTILL_PROMPT_VERSION);
  });
  it('schema-shaped outputs pass the runtime validator (single contract)', () => {
    const sample = {
      ops: [
        { op: 'createKnowledge', type: 'observation', statement: 'I noticed X.' },
        { op: 'addEvidence', knowledge: { kind: 'new', index: 0 }, sourceType: 'entry', sourceId: 'e1', stance: 'supports' },
        { op: 'addEvidence', knowledge: { kind: 'existing', id: 'k1' }, sourceType: 'entry', sourceId: 'e1', stance: 'contradicts', note: 'cuts against' },
      ],
      rationale: 'r',
      citations: [{ excerpt: 'Backed down' }],
    };
    expect(validateOps(sample.ops).every((v) => v.valid)).toBe(true);
    // Schema sanity: allowlisted op kinds only, closed objects
    const opSchemas = PROPOSAL_OPS_JSON_SCHEMA.properties.ops.items.anyOf as Array<{ properties: { op: { const: string } } }>;
    expect(opSchemas.map((s) => s.properties.op.const).sort()).toEqual(['addEvidence', 'createKnowledge', 'updateKnowledge']);
    expect(PROPOSAL_OPS_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});
