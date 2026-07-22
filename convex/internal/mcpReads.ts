// MCP read-tool support (Phase M Task 4, docs/spec/06-mcp-interface.md §3, §4:
// "Tool handlers call the same internal functions as the PWA ... with the
// resolved userId — the httpAction layer contains auth, rate limiting, and shape
// translation only"). Internal only ⇒ explicit userId first param (08 §2); no
// isolation row needed (registry only covers public functions). These mirror the
// detail shapes already returned by convex/knowledge.ts / convex/entries.ts /
// convex/proposals.ts but are re-implemented here (rather than called directly)
// because those are public `query`s bound to `requireUser(ctx)` (ctx.auth), while
// the MCP path resolves its subject from a bearer key and must pass userId
// explicitly — the same reason convex/internal/searchText.ts exists standalone.
import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { computeConfidence, type EvidenceSource } from '../lib/confidence';

const entryKindValidator = v.union(v.literal('journal'), v.literal('conversation'), v.literal('note'));
const proposalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('resolved'),
  v.literal('expired'),
  v.literal('superseded'),
);
const experimentStatusValidator = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('completed'),
  v.literal('abandoned'),
);

// --- atlas_search_knowledge: extend hybridSearch's minimal hit rows with the
// status/evidenceCounts/updatedAt fields 06 §3 requires in the tool result. ---
export const hydrateSearchKnowledge = internalQuery({
  args: { userId: v.id('users'), ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows = [];
    for (const idStr of args.ids) {
      const id = ctx.db.normalizeId('knowledge', idStr);
      const doc = id === null ? null : await ctx.db.get(id);
      if (doc === null || doc.userId !== args.userId) continue;
      const evidenceRows = await ctx.db
        .query('evidence')
        .withIndex('by_knowledge', (q) => q.eq('userId', args.userId).eq('knowledgeId', doc._id))
        .collect();
      const lastRevision = await ctx.db
        .query('revisions')
        .withIndex('by_target', (q) =>
          q.eq('userId', args.userId).eq('targetType', 'knowledge').eq('targetId', doc._id),
        )
        .order('desc')
        .first();
      rows.push({
        id: doc._id,
        type: doc.type,
        statement: doc.statement,
        confidence: doc.confidence,
        status: doc.status,
        evidenceCounts: {
          supports: evidenceRows.filter((e) => e.stance === 'supports').length,
          contradicts: evidenceRows.filter((e) => e.stance === 'contradicts').length,
        },
        updatedAt: lastRevision?._creationTime ?? doc._creationTime,
      });
    }
    return rows;
  },
});

// --- atlas_get_object: full knowledge detail (06 §3: statement, body, confidence
// + computed S/C, origin, evidence w/ source excerpts, relationships both
// directions, revision summaries, linked experiments). Null when missing/not owned
// (uniform not_found — the caller never learns whether the id merely doesn't
// exist or belongs to someone else). ---
export const getObject = internalQuery({
  args: { userId: v.id('users'), id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('knowledge', args.id);
    const doc = id === null ? null : await ctx.db.get(id);
    if (doc === null || doc.userId !== args.userId) return null;

    const evidenceRows = await ctx.db
      .query('evidence')
      .withIndex('by_knowledge', (q) => q.eq('userId', args.userId).eq('knowledgeId', doc._id))
      .collect();

    const duplicateOf: Record<string, string> = {};
    const evidence = [];
    for (const row of evidenceRows) {
      let source: { id: string; excerpt: string; occurredAt: number } | null = null;
      if (row.sourceType === 'entry') {
        const entryId = ctx.db.normalizeId('entries', row.sourceId);
        const entry = entryId === null ? null : await ctx.db.get(entryId);
        if (entry !== null && entry.userId === args.userId) {
          if (entry.duplicateOf !== undefined) duplicateOf[entry._id] = entry.duplicateOf;
          source = {
            id: entry._id,
            excerpt: (entry.title ?? entry.body).slice(0, 140),
            occurredAt: entry.occurredAt,
          };
        }
      }
      evidence.push({
        id: row._id,
        stance: row.stance,
        note: row.note,
        origin: row.origin,
        sourceType: row.sourceType,
        source,
      });
    }

    const computation = computeConfidence(
      evidenceRows.map(
        (row): EvidenceSource => ({
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          stance: row.stance,
        }),
      ),
      duplicateOf,
    );

    const revisions = (
      await ctx.db
        .query('revisions')
        .withIndex('by_target', (q) =>
          q.eq('userId', args.userId).eq('targetType', 'knowledge').eq('targetId', doc._id),
        )
        .order('desc')
        .collect()
    ).map((r) => ({ rev: r.rev, actor: r.actor, reason: r.reason, at: r._creationTime }));

    async function statementOf(knowledgeId: Id<'knowledge'>): Promise<string | null> {
      const k = await ctx.db.get(knowledgeId);
      return k !== null && k.userId === args.userId ? k.statement : null;
    }

    const outgoingRows = await ctx.db
      .query('relationships')
      .withIndex('by_from', (q) => q.eq('userId', args.userId).eq('fromId', doc._id))
      .collect();
    const incomingRows = await ctx.db
      .query('relationships')
      .withIndex('by_to', (q) => q.eq('userId', args.userId).eq('toId', doc._id))
      .collect();

    const relationships = {
      outgoing: await Promise.all(
        outgoingRows.map(async (r) => ({
          id: r._id,
          toId: r.toId,
          toStatement: await statementOf(r.toId),
          kind: r.kind,
          note: r.note,
        })),
      ),
      incoming: await Promise.all(
        incomingRows.map(async (r) => ({
          id: r._id,
          fromId: r.fromId,
          fromStatement: await statementOf(r.fromId),
          kind: r.kind,
          note: r.note,
        })),
      ),
    };

    const experimentRows = await ctx.db
      .query('experiments')
      .withIndex('by_knowledge', (q) => q.eq('userId', args.userId).eq('knowledgeId', doc._id))
      .collect();

    return {
      id: doc._id,
      type: doc.type,
      statement: doc.statement,
      body: doc.body,
      confidence: doc.confidence,
      confidenceOverridden: doc.confidenceOverridden,
      status: doc.status,
      origin: doc.origin,
      rev: doc.rev,
      computation,
      evidence,
      relationships,
      revisions,
      experiments: experimentRows.map((e) => ({ id: e._id, status: e.status, hypothesis: e.hypothesis })),
    };
  },
});

// --- atlas_list_entries: { from?, to?, kind?, limit? } → entry metadata. ---
export const listEntries = internalQuery({
  args: {
    userId: v.id('users'),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    kind: v.optional(entryKindValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query('entries')
      .withIndex('by_user', (q) => {
        const withUser = q.eq('userId', args.userId);
        if (args.from !== undefined && args.to !== undefined) {
          return withUser.gte('occurredAt', args.from).lte('occurredAt', args.to);
        }
        if (args.from !== undefined) return withUser.gte('occurredAt', args.from);
        if (args.to !== undefined) return withUser.lte('occurredAt', args.to);
        return withUser;
      })
      .order('desc')
      .collect();
    const filtered = rows.filter(
      (row) => row.archived !== true && (args.kind === undefined || row.kind === args.kind),
    );
    return filtered.slice(0, limit).map((row) => ({
      id: row._id,
      kind: row.kind,
      title: row.title,
      excerpt: row.body.slice(0, 120),
      occurredAt: row.occurredAt,
      source: row.source,
      editedAt: row.editedAt,
    }));
  },
});

// --- atlas_get_entry: full body + evidence rows citing it. ---
export const getEntry = internalQuery({
  args: { userId: v.id('users'), id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('entries', args.id);
    const doc = id === null ? null : await ctx.db.get(id);
    if (doc === null || doc.userId !== args.userId) return null;

    const citing = await ctx.db
      .query('evidence')
      .withIndex('by_source', (q) => q.eq('userId', args.userId).eq('sourceType', 'entry').eq('sourceId', doc._id))
      .collect();
    const citedBy = [];
    for (const row of citing) {
      const knowledge = await ctx.db.get(row.knowledgeId);
      if (knowledge === null || knowledge.userId !== args.userId) continue;
      citedBy.push({
        evidenceId: row._id,
        stance: row.stance,
        knowledgeId: knowledge._id,
        statement: knowledge.statement,
      });
    }

    return {
      id: doc._id,
      kind: doc.kind,
      title: doc.title,
      body: doc.body,
      occurredAt: doc.occurredAt,
      source: doc.source,
      duplicateOf: doc.duplicateOf,
      editedAt: doc.editedAt,
      archived: doc.archived ?? false,
      citedBy,
    };
  },
});

// --- atlas_list_proposals: { status?, limit? } → proposals w/ per-op resolutions.
// This is the feedback channel (06 §3) — unlike the app's proposals.list (pending
// only), MCP callers need every status to learn what was accepted/rejected. ---
export const listProposals = internalQuery({
  args: { userId: v.id('users'), status: v.optional(proposalStatusValidator), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows =
      args.status !== undefined
        ? await ctx.db
            .query('proposals')
            .withIndex('by_user_status', (q) => q.eq('userId', args.userId).eq('status', args.status!))
            .order('desc')
            .collect()
        : (
            await ctx.db
              .query('proposals')
              .withIndex('by_user_status', (q) => q.eq('userId', args.userId))
              .collect()
          ).sort((a, b) => b._creationTime - a._creationTime);

    return rows.slice(0, limit).map((p) => ({
      id: p._id,
      source: p.source,
      status: p.status,
      entryId: p.entryId,
      ops: p.ops,
      opResolutions: p.opResolutions,
      rationale: p.rationale,
      citations: p.citations,
      createdAt: p._creationTime,
      resolvedAt: p.resolvedAt,
    }));
  },
});

// --- atlas_list_experiments: { status? } → experiments w/ tested-object statement
// + latest outcome. ---
export const listExperiments = internalQuery({
  args: { userId: v.id('users'), status: v.optional(experimentStatusValidator) },
  handler: async (ctx, args) => {
    const rows =
      args.status !== undefined
        ? await ctx.db
            .query('experiments')
            .withIndex('by_user_status', (q) => q.eq('userId', args.userId).eq('status', args.status!))
            .collect()
        : await ctx.db
            .query('experiments')
            .withIndex('by_user_status', (q) => q.eq('userId', args.userId))
            .collect();

    const result = [];
    for (const experiment of rows) {
      const knowledge = await ctx.db.get(experiment.knowledgeId);
      const knowledgeStatement =
        knowledge !== null && knowledge.userId === args.userId ? knowledge.statement : null;
      const outcomes = await ctx.db
        .query('outcomes')
        .withIndex('by_experiment', (q) => q.eq('userId', args.userId).eq('experimentId', experiment._id))
        .collect();
      const latest =
        outcomes.length === 0 ? null : outcomes.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
      result.push({
        id: experiment._id,
        status: experiment.status,
        hypothesis: experiment.hypothesis,
        knowledgeId: experiment.knowledgeId,
        knowledgeStatement,
        latestOutcome:
          latest === null ? null : { result: latest.result, narrative: latest.narrative, observedAt: latest.observedAt },
      });
    }
    return result;
  },
});

// --- atlas_retrieve_context: relationships touching a set of knowledge ids
// (both directions), capped at `limit`. Compact edges only — the calling
// assistant already has (or can atlas_get_object for) the endpoint statements. ---
export const relationshipsForKnowledgeIds = internalQuery({
  args: { userId: v.id('users'), ids: v.array(v.string()), limit: v.number() },
  handler: async (ctx, args) => {
    const rows: { id: string; fromId: string; toId: string; kind: string; note: string | undefined }[] = [];
    const seen = new Set<string>();
    for (const idStr of args.ids) {
      const id = ctx.db.normalizeId('knowledge', idStr);
      if (id === null) continue;
      const [fromRows, toRows] = await Promise.all([
        ctx.db
          .query('relationships')
          .withIndex('by_from', (q) => q.eq('userId', args.userId).eq('fromId', id))
          .collect(),
        ctx.db
          .query('relationships')
          .withIndex('by_to', (q) => q.eq('userId', args.userId).eq('toId', id))
          .collect(),
      ]);
      for (const r of [...fromRows, ...toRows]) {
        if (seen.has(r._id)) continue;
        seen.add(r._id);
        rows.push({ id: r._id, fromId: r.fromId, toId: r.toId, kind: r.kind, note: r.note });
        if (rows.length >= args.limit) return rows;
      }
    }
    return rows;
  },
});

// --- Proposal-op reference existence check (05 §3 post-filter: "cited sourceIds
// must exist and belong to the user") for atlas_preview_proposal/atlas_submit_proposal.
// Takes flattened id lists (NOT raw ops — an unchecked "any" validator is banned
// outside schema.ts by scripts/check-invariants.sh, and ops are heterogeneous
// per-kind objects) computed
// by convex/mcp/proposalSupport.ts from an already-validateOps-passed op list.
// Returns which of the candidate ids actually exist and belong to this user. ---
export const checkRefExistence = internalQuery({
  args: {
    userId: v.id('users'),
    knowledgeIds: v.array(v.string()),
    entryIds: v.array(v.string()),
    outcomeIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    async function existing(ids: string[], table: 'knowledge' | 'entries' | 'outcomes'): Promise<Set<string>> {
      const found = new Set<string>();
      for (const idStr of new Set(ids)) {
        const id = ctx.db.normalizeId(table, idStr);
        const doc = id === null ? null : await ctx.db.get(id);
        if (doc !== null && doc.userId === args.userId) found.add(idStr);
      }
      return found;
    }
    const [knowledge, entries, outcomes] = await Promise.all([
      existing(args.knowledgeIds, 'knowledge'),
      existing(args.entryIds, 'entries'),
      existing(args.outcomeIds, 'outcomes'),
    ]);
    return {
      knowledgeIds: [...knowledge],
      entryIds: [...entries],
      outcomeIds: [...outcomes],
    };
  },
});
