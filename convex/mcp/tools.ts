// MCP tool registry (Phase M Task 4, docs/spec/06-mcp-interface.md §3 EXACTLY —
// names, args, result shapes). `atlas_list_reviews`/`atlas_get_review` are
// DEFERRED (no reviews exist yet; 12-roadmap Phase 6) — noted in the tools/list
// snapshot rather than stubbed out.
//
// Every handler receives the userId already resolved from the bearer key (06 §4:
// "the httpAction layer contains auth, rate limiting, and shape translation
// only") and calls internal functions exactly like the PWA does. Handler
// signature is (ctx, userId, args, keyId) — keyId is needed only by
// atlas_submit_proposal's idempotence runId; every other tool ignores it.
//
// `writes` is registry metadata (not enforced by types) asserted by the contract
// suite: no tool may declare 'knowledge' writes — capture writes entries
// directly, and all knowledge mutation goes through atlas_submit_proposal, which
// only ever writes a `proposals` row (06 §2's write-asymmetry invariant).
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
// MCP_PROPOSAL_OPS_JSON_SCHEMA (not distill's PROPOSAL_OPS_JSON_SCHEMA) is the
// schema embedded below — full six op kinds, genuinely-optional fields (no
// null-union hack), sourceType enum ['entry','outcome']. Distill's schema is
// narrower on purpose (OpenAI structured-outputs constraints + distill's own
// restricted op set) — see convex/shared/proposalOps.ts's comment for the full
// rationale for this intentional, documented asymmetry.
import { MCP_PROPOSAL_OPS_JSON_SCHEMA } from '../shared/proposalOps';
import { sha256Hex, type Scope } from './auth';
import { ToolError } from './errors';
import { allValid, checkProposalOps, parseCitations } from './proposalSupport';

const SITE_URL = process.env.SITE_URL ?? 'https://atlas-phi-beige.vercel.app';

// Model/promptVersion recorded on MCP-submitted proposals: the reasoning happened
// in the CONNECTED CLIENT (ChatGPT/Codex/etc.), not in an Atlas-side model call —
// these are honest placeholders, not "we ran gpt-5.6-terra on this."
const MCP_PROPOSAL_MODEL = 'external-mcp-client';
const MCP_PROPOSAL_PROMPT_VERSION = 'n/a';

const KNOWLEDGE_TYPES = [
  'observation',
  'interpretation',
  'insight',
  'pattern',
  'principle',
  'question',
] as const;
const CONFIDENCE_VALUES = ['hypothesis', 'tentative', 'supported', 'strong', 'mixed', 'contradicted'] as const;
const ENTRY_KINDS = ['journal', 'conversation', 'note'] as const;
const PROPOSAL_STATUSES = ['pending', 'resolved', 'expired', 'superseded'] as const;
const EXPERIMENT_STATUSES = ['draft', 'active', 'completed', 'abandoned'] as const;

// --- Minimal argument helpers (no external JSON-schema-validator dependency —
// each handler checks exactly the shape it needs; unrecognized input fails with
// a structured 'invalid_ops' ToolError, never a silent coercion). ---

function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ToolError('invalid_ops', `${field} must be a non-empty string.`);
  }
  return v;
}

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ToolError('invalid_ops', `${field} must be a string.`);
  return v;
}

function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ToolError('invalid_ops', `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

function optionalEnumArray<T extends string>(
  args: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T[] | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && (allowed as readonly string[]).includes(x))) {
    throw new ToolError('invalid_ops', `${field} must be an array of: ${allowed.join(', ')}.`);
  }
  return v as T[];
}

function clampLimit(args: Record<string, unknown>, fallback: number, max: number): number {
  const v = args.limit;
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    throw new ToolError('invalid_ops', 'limit must be a positive number.');
  }
  return Math.min(Math.floor(v), max);
}

/** ISO 8601 -> epoch ms. Undefined input -> undefined output (caller decides the default). */
function parseIsoOptional(args: Record<string, unknown>, field: string): number | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ToolError('invalid_ops', `${field} must be an ISO 8601 date string.`);
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new ToolError('invalid_ops', `${field} is not a valid ISO 8601 date: ${v}`);
  return ms;
}

export type ToolWrites = 'none' | 'entries' | 'proposals';

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: Scope;
  writes: ToolWrites;
  handler: (
    ctx: ActionCtx,
    userId: Id<'users'>,
    args: Record<string, unknown>,
    keyId: Id<'apiKeys'>,
  ) => Promise<unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: 'atlas_search_knowledge',
    description:
      'Read-only. Hybrid vector+text search over the user\'s active knowledge base. Returns ranked, compact rows.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        types: { type: 'array', items: { enum: KNOWLEDGE_TYPES } },
        confidence: { type: 'array', items: { enum: CONFIDENCE_VALUES } },
        status: { enum: ['active', 'archived'] },
        limit: { type: 'integer', maximum: 25 },
      },
      required: ['query'],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const query = requireString(args, 'query');
      const types = optionalEnumArray(args, 'types', KNOWLEDGE_TYPES);
      const confidenceFilter = optionalEnumArray(args, 'confidence', CONFIDENCE_VALUES);
      const status = optionalEnum(args, 'status', ['active', 'archived'] as const) ?? 'active';
      const limit = clampLimit(args, 10, 25);
      // Over-fetch from the fused rank list so post-hoc type/confidence/status
      // filtering (hybridSearch itself has no such filters) doesn't starve the
      // requested limit.
      const fetchLimit = Math.min(100, limit * 5 + 20);

      const hits = await ctx.runAction(internal.ai.search.hybridSearch, {
        userId,
        query,
        scope: 'knowledge',
        limit: fetchLimit,
      });
      const rows = await ctx.runQuery(internal.internal.mcpReads.hydrateSearchKnowledge, {
        userId,
        ids: hits.map((h) => h.id),
      });
      const filtered = rows.filter(
        (row) =>
          (types === undefined || types.includes(row.type as (typeof KNOWLEDGE_TYPES)[number])) &&
          (confidenceFilter === undefined ||
            confidenceFilter.includes(row.confidence as (typeof CONFIDENCE_VALUES)[number])) &&
          row.status === status,
      );
      return filtered.slice(0, limit);
    },
  },
  {
    name: 'atlas_get_object',
    description:
      'Read-only. Full knowledge object: statement, body, confidence, evidence (with source excerpts), relationships (both directions), revision history, and linked experiments.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const id = requireString(args, 'id');
      const obj = await ctx.runQuery(internal.internal.mcpReads.getObject, { userId, id });
      if (obj === null) throw new ToolError('not_found', 'Knowledge object not found.');
      return obj;
    },
  },
  {
    name: 'atlas_list_entries',
    description: 'Read-only. Entry metadata (excerpts, not full bodies), optionally filtered by date range or kind.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'ISO 8601 date; inclusive lower bound on occurredAt.' },
        to: { type: 'string', description: 'ISO 8601 date; inclusive upper bound on occurredAt.' },
        kind: { enum: ENTRY_KINDS },
        limit: { type: 'integer' },
      },
      required: [],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const from = parseIsoOptional(args, 'from');
      const to = parseIsoOptional(args, 'to');
      const kind = optionalEnum(args, 'kind', ENTRY_KINDS);
      const limit = clampLimit(args, 20, 100);
      return await ctx.runQuery(internal.internal.mcpReads.listEntries, { userId, from, to, kind, limit });
    },
  },
  {
    name: 'atlas_get_entry',
    description: 'Read-only. Full entry body plus the knowledge rows this entry supports or contradicts.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const id = requireString(args, 'id');
      const entry = await ctx.runQuery(internal.internal.mcpReads.getEntry, { userId, id });
      if (entry === null) throw new ToolError('not_found', 'Entry not found.');
      return entry;
    },
  },
  {
    name: 'atlas_list_proposals',
    description:
      "Read-only. Proposals with per-op resolutions — this is how you learn what the user accepted or rejected from past proposals.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { status: { enum: PROPOSAL_STATUSES }, limit: { type: 'integer' } },
      required: [],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const status = optionalEnum(args, 'status', PROPOSAL_STATUSES);
      const limit = clampLimit(args, 20, 100);
      return await ctx.runQuery(internal.internal.mcpReads.listProposals, { userId, status, limit });
    },
  },
  {
    name: 'atlas_list_experiments',
    description: 'Read-only. Experiments with their tested-object statement and latest outcome, if any.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { status: { enum: EXPERIMENT_STATUSES } },
      required: [],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const status = optionalEnum(args, 'status', EXPERIMENT_STATUSES);
      return await ctx.runQuery(internal.internal.mcpReads.listExperiments, { userId, status });
    },
  },
  {
    name: 'atlas_retrieve_context',
    description:
      'Read-only. The retrieval bundle for a question: relevant knowledge, entry excerpts, and relationships between them — ranked, with NO synthesis. Reason over this yourself.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { question: { type: 'string' }, limit: { type: 'integer', maximum: 20 } },
      required: ['question'],
    },
    scope: 'read',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      const question = requireString(args, 'question');
      const limit = clampLimit(args, 10, 20);
      const hits = await ctx.runAction(internal.ai.search.hybridSearch, {
        userId,
        query: question,
        scope: 'both',
        limit,
      });
      const knowledge = hits
        .filter((h) => h.objectType === 'knowledge')
        .map((h) => ({ id: h.id, type: h.type, statement: h.statement, confidence: h.confidence, score: h.score }));
      const entries = hits
        .filter((h) => h.objectType === 'entry')
        .map((h) => ({ id: h.id, excerpt: h.excerpt }));
      const relationships = await ctx.runQuery(internal.internal.mcpReads.relationshipsForKnowledgeIds, {
        userId,
        ids: knowledge.map((k) => k.id),
        limit: limit * 2,
      });
      return { knowledge, entries, relationships };
    },
  },
  {
    name: 'atlas_create_entry',
    description:
      'Direct write: creates a raw entry (source: mcp). Capture the user\'s words faithfully — do not editorialize. Use duplicateOf when re-telling a previously captured event.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { enum: ENTRY_KINDS },
        title: { type: 'string' },
        body: { type: 'string' },
        occurredAt: { type: 'string', description: 'ISO 8601 date; defaults to now.' },
        duplicateOf: { type: 'string' },
      },
      required: ['kind', 'body'],
    },
    scope: 'capture',
    writes: 'entries',
    handler: async (ctx, userId, args) => {
      const kind = optionalEnum(args, 'kind', ENTRY_KINDS);
      if (kind === undefined) throw new ToolError('invalid_ops', 'kind is required.');
      const body = requireString(args, 'body');
      const title = optionalString(args, 'title');
      const occurredAt = parseIsoOptional(args, 'occurredAt') ?? Date.now();
      const duplicateOf = optionalString(args, 'duplicateOf');

      const result = await ctx.runMutation(internal.internal.mcpWrites.createEntry, {
        userId,
        kind,
        title,
        body,
        occurredAt,
        duplicateOf,
      });
      if (!result.ok) throw new ToolError('not_found', 'duplicateOf entry not found.');
      return { id: result.id };
    },
  },
  {
    name: 'atlas_preview_proposal',
    description:
      'Read-only dry run: validates a proposed op list (the same validator + post-filters atlas_submit_proposal uses) and returns per-op verdicts with warnings (e.g. near-duplicate knowledge) WITHOUT writing anything. Use this to fix problems before submitting.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ops: MCP_PROPOSAL_OPS_JSON_SCHEMA,
        rationale: { type: 'string' },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sourceType: { type: 'string' }, sourceId: { type: 'string' }, excerpt: { type: 'string' } },
            required: ['sourceType', 'sourceId'],
          },
        },
      },
      required: ['ops', 'rationale', 'citations'],
    },
    scope: 'propose',
    writes: 'none',
    handler: async (ctx, userId, args) => {
      requireString(args, 'rationale');
      if (parseCitations(args.citations) === null) {
        throw new ToolError('invalid_ops', 'citations must be an array of { sourceType, sourceId, excerpt? }.');
      }
      return await checkProposalOps(ctx, userId, args.ops, true);
    },
  },
  {
    name: 'atlas_submit_proposal',
    description:
      "Writes a pending proposal (source: mcp) after validating identically to atlas_preview_proposal. Never applies changes directly. The user must approve these changes in Atlas before they take effect.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ops: MCP_PROPOSAL_OPS_JSON_SCHEMA,
        rationale: { type: 'string' },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sourceType: { type: 'string' }, sourceId: { type: 'string' }, excerpt: { type: 'string' } },
            required: ['sourceType', 'sourceId'],
          },
        },
        entryId: { type: 'string' },
      },
      required: ['ops', 'rationale', 'citations'],
    },
    scope: 'propose',
    writes: 'proposals',
    handler: async (ctx, userId, args, keyId) => {
      const rationale = requireString(args, 'rationale');
      const citations = parseCitations(args.citations);
      if (citations === null) {
        throw new ToolError('invalid_ops', 'citations must be an array of { sourceType, sourceId, excerpt? }.');
      }
      const entryId = optionalString(args, 'entryId');

      const verdicts = await checkProposalOps(ctx, userId, args.ops, false);
      if (!allValid(verdicts)) {
        throw new ToolError('invalid_ops', 'One or more proposal ops are invalid.', { verdicts });
      }

      if (entryId !== undefined) {
        const existence = await ctx.runQuery(internal.internal.mcpReads.checkRefExistence, {
          userId,
          knowledgeIds: [],
          entryIds: [entryId],
          outcomeIds: [],
        });
        if (!existence.entryIds.includes(entryId)) {
          throw new ToolError('not_found', 'entryId not found.');
        }
      }

      const ops = args.ops as unknown[];
      // Idempotence key (documented, not enforced at the proposalStore layer —
      // upsertProposal has no runId-collision check today; this establishes a
      // stable, traceable identifier per distinct submission content so repeated
      // identical tool calls are at least recognizable in aiRuns/proposals data,
      // per keyId+content-hash).
      const opsHash = (await sha256Hex(JSON.stringify(ops))).slice(0, 16);
      const runId = `mcp:${keyId}:${opsHash}`;

      const proposalId = await ctx.runMutation(internal.internal.proposalStore.upsertProposal, {
        userId,
        source: 'mcp',
        runId,
        entryId: entryId as never,
        ops: ops as never,
        rationale,
        citations,
        model: MCP_PROPOSAL_MODEL,
        promptVersion: MCP_PROPOSAL_PROMPT_VERSION,
      });

      return { proposalId, opCount: ops.length, reviewUrl: `${SITE_URL}/review` };
    },
  },
];
