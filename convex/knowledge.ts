import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { computeConfidence, type EvidenceSource } from './lib/confidence';
import { knowledgeSnapshot } from './lib/revisions';
import { requireNonEmpty, requireStatement } from './lib/validate';

const knowledgeType = v.union(
  v.literal('observation'), v.literal('interpretation'), v.literal('insight'),
  v.literal('pattern'), v.literal('principle'), v.literal('question'),
);
const confidence = v.union(
  v.literal('hypothesis'), v.literal('tentative'), v.literal('supported'),
  v.literal('strong'), v.literal('mixed'), v.literal('contradicted'),
);

/** Write the post-mutation snapshot as revision `rev`. Call after every knowledge patch. */
async function writeRevision(
  ctx: MutationCtx,
  user: Doc<'users'>,
  knowledgeId: Id<'knowledge'>,
  rev: number,
  reason: string,
) {
  const doc = await ctx.db.get(knowledgeId);
  if (doc === null) throw new ConvexError({ code: 'not_found', message: 'Not found.' });
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'knowledge',
    targetId: knowledgeId,
    rev,
    snapshot: knowledgeSnapshot(doc),
    actor: 'user',
    reason,
  });
}

export const create = mutation({
  args: { type: knowledgeType, statement: v.string(), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const id = await ctx.db.insert('knowledge', {
      userId: user._id,
      type: args.type,
      statement: requireStatement(args.statement),
      body: args.body,
      confidence: 'hypothesis',
      confidenceOverridden: false,
      status: 'active',
      origin: 'user',
      rev: 1,
    });
    await writeRevision(ctx, user, id, 1, 'Created');
    return id;
  },
});

export const revise = mutation({
  args: {
    id: v.id('knowledge'),
    patch: v.object({
      statement: v.optional(v.string()),
      body: v.optional(v.string()),
      type: v.optional(knowledgeType),
    }),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = assertOwner(await ctx.db.get(args.id), user);
    const reason = requireNonEmpty(args.reason, 'reason');
    const patch: { statement?: string; body?: string; type?: Doc<'knowledge'>['type']; rev: number } = {
      rev: doc.rev + 1,
    };
    if (args.patch.statement !== undefined) patch.statement = requireStatement(args.patch.statement);
    if (args.patch.body !== undefined) patch.body = args.patch.body;
    if (args.patch.type !== undefined) patch.type = args.patch.type;
    if (Object.keys(patch).length === 1) {
      throw new ConvexError({ code: 'invalid_input', message: 'patch must not be empty.' });
    }
    await ctx.db.patch(doc._id, patch);
    await writeRevision(ctx, user, doc._id, patch.rev, reason);
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id('knowledge'), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = assertOwner(await ctx.db.get(args.id), user);
    const reason = requireNonEmpty(args.reason, 'reason');
    const rev = doc.rev + 1;
    await ctx.db.patch(doc._id, { status: 'archived', rev });
    await writeRevision(ctx, user, doc._id, rev, reason);
    return null;
  },
});

/** List rows with raw S/C counts for the evidence bar; sorted by last revision time. */
export const list = query({
  args: {
    type: v.optional(knowledgeType),
    status: v.optional(v.union(v.literal('active'), v.literal('archived'))),
    confidence: v.optional(confidence),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const status = args.status ?? 'active';
    const rows =
      args.type !== undefined
        ? await ctx.db
            .query('knowledge')
            .withIndex('by_user_status_type', (q) =>
              q.eq('userId', user._id).eq('status', status).eq('type', args.type!),
            )
            .collect()
        : await ctx.db
            .query('knowledge')
            .withIndex('by_user_status_type', (q) => q.eq('userId', user._id).eq('status', status))
            .collect();
    const filtered =
      args.confidence !== undefined ? rows.filter((k) => k.confidence === args.confidence) : rows;

    const result = [];
    for (const k of filtered) {
      const evidenceRows = await ctx.db
        .query('evidence')
        .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', k._id))
        .collect();
      const lastRevision = await ctx.db
        .query('revisions')
        .withIndex('by_target', (q) =>
          q.eq('userId', user._id).eq('targetType', 'knowledge').eq('targetId', k._id),
        )
        .order('desc')
        .first();
      result.push({
        _id: k._id,
        type: k.type,
        statement: k.statement,
        confidence: k.confidence,
        status: k.status,
        supports: evidenceRows.filter((e) => e.stance === 'supports').length,
        contradicts: evidenceRows.filter((e) => e.stance === 'contradicts').length,
        lastRevisedAt: lastRevision?._creationTime ?? k._creationTime,
      });
    }
    return result.sort((a, b) => b.lastRevisedAt - a.lastRevisedAt);
  },
});

/** The provenance screen's data (AC-4.1): everything on one query. */
export const get = query({
  args: { id: v.id('knowledge') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = assertOwner(await ctx.db.get(args.id), user);

    const evidenceRows = await ctx.db
      .query('evidence')
      .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', doc._id))
      .collect();

    const duplicateOf: Record<string, string> = {};
    const evidence = [];
    for (const row of evidenceRows) {
      let source: { id: string; excerpt: string; occurredAt: number } | null = null;
      if (row.sourceType === 'entry') {
        const entryId = ctx.db.normalizeId('entries', row.sourceId);
        const entry = entryId === null ? null : await ctx.db.get(entryId);
        if (entry !== null && entry.userId === user._id) {
          if (entry.duplicateOf !== undefined) duplicateOf[entry._id] = entry.duplicateOf;
          source = {
            id: entry._id,
            excerpt: (entry.title ?? entry.body).slice(0, 140),
            occurredAt: entry.occurredAt,
          };
        }
      }
      evidence.push({
        _id: row._id,
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
          q.eq('userId', user._id).eq('targetType', 'knowledge').eq('targetId', doc._id),
        )
        .order('desc')
        .collect()
    ).map((r) => ({
      rev: r.rev,
      actor: r.actor,
      reason: r.reason,
      at: r._creationTime,
      snapshotStatement: (r.snapshot as { statement?: string }).statement ?? '',
    }));

    return {
      _id: doc._id,
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
      revisions,
    };
  },
});
