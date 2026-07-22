// The proposal-op contract — single source of truth for every AI-originated mutation.
// Imported by: applyProposal (mutation boundary), the AI pipeline (structured output
// validation), and the MCP layer (tool input schema generation). Spec: 03 §7, 05 §3.
//
// Runtime checking here is allowlist-based: unknown op kinds AND unknown keys are
// rejected (the playbook's PERSISTED_KEYS discipline — drift fails loudly).

import { v } from 'convex/values';

export const KNOWLEDGE_TYPES = [
  'observation',
  'interpretation',
  'insight',
  'pattern',
  'principle',
  'question',
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const STANCES = ['supports', 'contradicts', 'neutral'] as const;
export type Stance = (typeof STANCES)[number];

export const RELATIONSHIP_KINDS = [
  'derives-from',
  'generalizes',
  'contradicts',
  'relates-to',
  'answers',
  'supersedes',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const STATEMENT_MAX_LENGTH = 280;

/** Reference to an existing object, or to an object created earlier in the same proposal. */
export type OpRef = { kind: 'existing'; id: string } | { kind: 'new'; index: number };

export type ProposalOp =
  | { op: 'createKnowledge'; type: KnowledgeType; statement: string; body?: string }
  | {
      op: 'updateKnowledge';
      target: OpRef;
      patch: { statement?: string; body?: string; type?: KnowledgeType };
      reason: string;
    }
  | { op: 'archiveKnowledge'; target: OpRef; reason: string }
  | {
      op: 'addEvidence';
      knowledge: OpRef;
      sourceType: 'entry' | 'outcome';
      sourceId: string;
      stance: Stance;
      note?: string;
    }
  | { op: 'createRelationship'; from: OpRef; to: OpRef; kind: RelationshipKind; note?: string }
  | {
      op: 'createExperiment';
      knowledge: OpRef;
      hypothesis: string;
      behavior: string;
      context: string;
      successCriteria: string;
      failureCriteria: string;
      observationTarget: string;
    };

export type OpVerdict = { valid: true } | { valid: false; error: string };

// --- Key allowlists (checked exhaustively below) ---

const OP_KEYS: Record<ProposalOp['op'], readonly string[]> = {
  createKnowledge: ['op', 'type', 'statement', 'body'],
  updateKnowledge: ['op', 'target', 'patch', 'reason'],
  archiveKnowledge: ['op', 'target', 'reason'],
  addEvidence: ['op', 'knowledge', 'sourceType', 'sourceId', 'stance', 'note'],
  createRelationship: ['op', 'from', 'to', 'kind', 'note'],
  createExperiment: [
    'op',
    'knowledge',
    'hypothesis',
    'behavior',
    'context',
    'successCriteria',
    'failureCriteria',
    'observationTarget',
  ],
};

const PATCH_KEYS = ['statement', 'body', 'type'] as const;

// --- Helpers ---

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

function checkStatement(x: unknown): string | null {
  if (!isNonEmptyString(x)) return 'statement must be a non-empty string';
  if (x.length > STATEMENT_MAX_LENGTH)
    return `statement exceeds ${STATEMENT_MAX_LENGTH} characters`;
  return null;
}

/**
 * Validates an OpRef. `newCreationCount` = number of createKnowledge ops appearing
 * BEFORE the op holding this ref; a 'new' ref may only point at one of those.
 */
function checkRef(x: unknown, newCreationCount: number, field: string): string | null {
  if (!isRecord(x)) return `${field} must be an OpRef object`;
  if (x.kind === 'existing') {
    const keys = Object.keys(x).sort();
    if (keys.join(',') !== 'id,kind') return `${field} has unknown keys`;
    return isNonEmptyString(x.id) ? null : `${field}.id must be a non-empty string`;
  }
  if (x.kind === 'new') {
    const keys = Object.keys(x).sort();
    if (keys.join(',') !== 'index,kind') return `${field} has unknown keys`;
    if (typeof x.index !== 'number' || !Number.isInteger(x.index) || x.index < 0)
      return `${field}.index must be a non-negative integer`;
    if (x.index >= newCreationCount)
      return `${field} references new object #${x.index}, but only ${newCreationCount} createKnowledge op(s) precede this op`;
    return null;
  }
  return `${field}.kind must be 'existing' or 'new'`;
}

function checkUnknownKeys(x: Record<string, unknown>, op: ProposalOp['op']): string | null {
  const allowed = OP_KEYS[op];
  const unknown = Object.keys(x).filter((k) => !allowed.includes(k));
  return unknown.length > 0 ? `unknown key(s) for ${op}: ${unknown.join(', ')}` : null;
}

// --- Per-op validation ---

function checkOp(x: unknown, newCreationCount: number): OpVerdict {
  if (!isRecord(x)) return { valid: false, error: 'op must be an object' };
  const kind = x.op;
  if (typeof kind !== 'string' || !(kind in OP_KEYS))
    return { valid: false, error: `unknown op kind: ${String(kind)}` };
  const op = kind as ProposalOp['op'];

  const keyError = checkUnknownKeys(x, op);
  if (keyError) return { valid: false, error: keyError };

  const fail = (error: string): OpVerdict => ({ valid: false, error });

  switch (op) {
    case 'createKnowledge': {
      if (!KNOWLEDGE_TYPES.includes(x.type as KnowledgeType)) return fail('invalid knowledge type');
      const s = checkStatement(x.statement);
      if (s) return fail(s);
      if (x.body !== undefined && typeof x.body !== 'string') return fail('body must be a string');
      return { valid: true };
    }
    case 'updateKnowledge': {
      const r = checkRef(x.target, newCreationCount, 'target');
      if (r) return fail(r);
      if (!isRecord(x.patch)) return fail('patch must be an object');
      const patchKeys = Object.keys(x.patch);
      if (patchKeys.length === 0) return fail('patch must not be empty');
      const unknownPatch = patchKeys.filter((k) => !(PATCH_KEYS as readonly string[]).includes(k));
      if (unknownPatch.length > 0) return fail(`unknown patch key(s): ${unknownPatch.join(', ')}`);
      if (x.patch.statement !== undefined) {
        const s = checkStatement(x.patch.statement);
        if (s) return fail(s);
      }
      if (x.patch.body !== undefined && typeof x.patch.body !== 'string')
        return fail('patch.body must be a string');
      if (x.patch.type !== undefined && !KNOWLEDGE_TYPES.includes(x.patch.type as KnowledgeType))
        return fail('invalid patch.type');
      if (!isNonEmptyString(x.reason)) return fail('reason is required');
      return { valid: true };
    }
    case 'archiveKnowledge': {
      const r = checkRef(x.target, newCreationCount, 'target');
      if (r) return fail(r);
      if (!isNonEmptyString(x.reason)) return fail('reason is required');
      return { valid: true };
    }
    case 'addEvidence': {
      const r = checkRef(x.knowledge, newCreationCount, 'knowledge');
      if (r) return fail(r);
      if (x.sourceType !== 'entry' && x.sourceType !== 'outcome')
        return fail("sourceType must be 'entry' or 'outcome'");
      if (!isNonEmptyString(x.sourceId)) return fail('sourceId is required');
      if (!STANCES.includes(x.stance as Stance)) return fail('invalid stance');
      if (x.note !== undefined && typeof x.note !== 'string') return fail('note must be a string');
      return { valid: true };
    }
    case 'createRelationship': {
      const rf = checkRef(x.from, newCreationCount, 'from');
      if (rf) return fail(rf);
      const rt = checkRef(x.to, newCreationCount, 'to');
      if (rt) return fail(rt);
      if (!RELATIONSHIP_KINDS.includes(x.kind as RelationshipKind))
        return fail('invalid relationship kind');
      if (x.note !== undefined && typeof x.note !== 'string') return fail('note must be a string');
      if (
        isRecord(x.from) &&
        isRecord(x.to) &&
        JSON.stringify(x.from) === JSON.stringify(x.to)
      )
        return fail('relationship cannot point at itself');
      return { valid: true };
    }
    case 'createExperiment': {
      const r = checkRef(x.knowledge, newCreationCount, 'knowledge');
      if (r) return fail(r);
      for (const field of [
        'hypothesis',
        'behavior',
        'context',
        'successCriteria',
        'failureCriteria',
        'observationTarget',
      ] as const) {
        if (!isNonEmptyString(x[field])) return fail(`${field} is required`);
      }
      return { valid: true };
    }
  }
}

/**
 * Validates a full op list. Returns one verdict per op (positionally).
 * A 'new' OpRef at position i may only reference createKnowledge ops at positions < i.
 */
export function validateOps(ops: unknown): OpVerdict[] {
  if (!Array.isArray(ops)) return [{ valid: false, error: 'ops must be an array' }];
  const verdicts: OpVerdict[] = [];
  let newCreationCount = 0;
  for (const raw of ops) {
    verdicts.push(checkOp(raw, newCreationCount));
    if (isRecord(raw) && raw.op === 'createKnowledge') newCreationCount += 1;
  }
  return verdicts;
}

/** True only if every op in the list is valid. */
export function allOpsValid(ops: unknown): ops is ProposalOp[] {
  const verdicts = validateOps(ops);
  return verdicts.length > 0 && verdicts.every((verdict) => verdict.valid);
}

// --- Structured-output JSON schema (docs/spec/05-ai-pipeline.md §3) ---
//
// Mirrors the ProposalOp contract above for OpenAI's structured-outputs (Responses
// API json_schema) contract. Distill deliberately proposes only createKnowledge / addEvidence /
// updateKnowledge (archiveKnowledge, createRelationship, createExperiment are
// out of scope for distill and excluded here on purpose) — validateOps above still
// accepts all six kinds for other pipeline stages (e.g. connect). Structured-outputs
// constraints: every object carries `additionalProperties: false` + a full `required`
// array; no min/max/length/pattern constraints (those stay enforced by validateOps
// and code-level post-filters); optional fields are modeled as required-but-nullable
// via `anyOf` with `{ type: 'null' }` since the schema has no notion of "optional".

const OP_REF_JSON_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { const: 'existing' },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { const: 'new' },
        index: { type: 'integer' },
      },
      required: ['kind', 'index'],
    },
  ],
} as const;

const NULLABLE_STRING_JSON_SCHEMA = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

const CREATE_KNOWLEDGE_OP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'createKnowledge' },
    type: { enum: KNOWLEDGE_TYPES },
    statement: { type: 'string' },
    body: NULLABLE_STRING_JSON_SCHEMA,
  },
  required: ['op', 'type', 'statement', 'body'],
} as const;

const ADD_EVIDENCE_OP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'addEvidence' },
    knowledge: OP_REF_JSON_SCHEMA,
    // Distill only ever cites the entry it was run on — narrowed to a single
    // const here (schema-only; the runtime validator above still accepts
    // 'outcome' for Phase 4's outcome-sourced proposals via other pipeline
    // stages, e.g. connect).
    sourceType: { const: 'entry' },
    sourceId: { type: 'string' },
    stance: { enum: STANCES },
    note: NULLABLE_STRING_JSON_SCHEMA,
  },
  required: ['op', 'knowledge', 'sourceType', 'sourceId', 'stance', 'note'],
} as const;

const UPDATE_KNOWLEDGE_OP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'updateKnowledge' },
    target: OP_REF_JSON_SCHEMA,
    patch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        statement: NULLABLE_STRING_JSON_SCHEMA,
        body: NULLABLE_STRING_JSON_SCHEMA,
        type: { anyOf: [{ enum: KNOWLEDGE_TYPES }, { type: 'null' }] },
      },
      required: ['statement', 'body', 'type'],
    },
    reason: { type: 'string' },
  },
  required: ['op', 'target', 'patch', 'reason'],
} as const;

/** JSON Schema for distill's structured output: `{ ops, rationale, citations }`. */
export const PROPOSAL_OPS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ops: {
      type: 'array',
      items: {
        anyOf: [
          CREATE_KNOWLEDGE_OP_JSON_SCHEMA,
          ADD_EVIDENCE_OP_JSON_SCHEMA,
          UPDATE_KNOWLEDGE_OP_JSON_SCHEMA,
        ],
      },
    },
    rationale: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { excerpt: { type: 'string' } },
        required: ['excerpt'],
      },
    },
  },
  required: ['ops', 'rationale', 'citations'],
};

// --- Convex arg validator (Phase 3a Task 4) ---
//
// Mirrors ProposalOp exactly at the Convex boundary. Required because the
// invariant lint forbids the any-validator outside schema.ts — convex/proposals.ts
// and convex/internal/proposalStore.ts accept op payloads as args and need a real
// shape, not an unchecked any. This validator enforces STRUCTURE only (which keys,
// which primitive types); validateOps above still enforces the semantic rules
// (non-empty strings, statement length, ref bounds) and must always run on top of it.

const opRefValidator = v.union(
  v.object({ kind: v.literal('existing'), id: v.string() }),
  v.object({ kind: v.literal('new'), index: v.number() }),
);

const knowledgeTypeValidator = v.union(
  v.literal('observation'),
  v.literal('interpretation'),
  v.literal('insight'),
  v.literal('pattern'),
  v.literal('principle'),
  v.literal('question'),
);

const stanceValidator = v.union(v.literal('supports'), v.literal('contradicts'), v.literal('neutral'));

const relationshipKindValidator = v.union(
  v.literal('derives-from'),
  v.literal('generalizes'),
  v.literal('contradicts'),
  v.literal('relates-to'),
  v.literal('answers'),
  v.literal('supersedes'),
);

export const proposalOpValidator = v.union(
  v.object({
    op: v.literal('createKnowledge'),
    type: knowledgeTypeValidator,
    statement: v.string(),
    body: v.optional(v.string()),
  }),
  v.object({
    op: v.literal('updateKnowledge'),
    target: opRefValidator,
    patch: v.object({
      statement: v.optional(v.string()),
      body: v.optional(v.string()),
      type: v.optional(knowledgeTypeValidator),
    }),
    reason: v.string(),
  }),
  v.object({
    op: v.literal('archiveKnowledge'),
    target: opRefValidator,
    reason: v.string(),
  }),
  v.object({
    op: v.literal('addEvidence'),
    knowledge: opRefValidator,
    sourceType: v.union(v.literal('entry'), v.literal('outcome')),
    sourceId: v.string(),
    stance: stanceValidator,
    note: v.optional(v.string()),
  }),
  v.object({
    op: v.literal('createRelationship'),
    from: opRefValidator,
    to: opRefValidator,
    kind: relationshipKindValidator,
    note: v.optional(v.string()),
  }),
  v.object({
    op: v.literal('createExperiment'),
    knowledge: opRefValidator,
    hypothesis: v.string(),
    behavior: v.string(),
    context: v.string(),
    successCriteria: v.string(),
    failureCriteria: v.string(),
    observationTarget: v.string(),
  }),
);
