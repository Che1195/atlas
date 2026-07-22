// Shared domain write helpers (docs/spec/03 §7): the single implementation behind
// both the manual-entry mutations (convex/knowledge.ts, convex/evidence.ts) and the
// AI-approved path (applyProposal, added in a later Phase 3a task). Ctx-level — NOT
// pure — so these live here rather than convex/lib (which stays pure, no ctx).
//
// Callers pass `who: WriteActor` to stamp the resulting revision's actor/proposalId,
// and `origin: 'user' | 'ai'` on the row itself. Every other behavior (validation,
// confidence computation, rev bumping) is byte-identical to the pre-refactor bodies.

import { ConvexError } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { assertOwner } from '../lib/auth';
import { computeConfidence, type EvidenceSource } from '../lib/confidence';
import { experimentSnapshot, knowledgeSnapshot } from '../lib/revisions';
import { requireNonEmpty, requireStatement } from '../lib/validate';
import type { KnowledgeType, RelationshipKind, Stance } from '../shared/proposalOps';

export type WriteActor = { actor: 'user' | 'ai-approved'; proposalId?: Id<'proposals'> };

/** Write the post-mutation snapshot as revision `rev`. Call after every knowledge patch. */
async function writeRevision(
  ctx: MutationCtx,
  user: Doc<'users'>,
  knowledgeId: Id<'knowledge'>,
  rev: number,
  reason: string,
  who: WriteActor,
) {
  const doc = assertOwner(await ctx.db.get(knowledgeId), user);
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'knowledge',
    targetId: knowledgeId,
    rev,
    snapshot: knowledgeSnapshot(doc),
    actor: who.actor,
    reason,
    proposalId: who.proposalId,
  });
}

export async function insertKnowledge(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: { type: KnowledgeType; statement: string; body?: string; origin: 'user' | 'ai' },
  who: WriteActor,
): Promise<Id<'knowledge'>> {
  const id = await ctx.db.insert('knowledge', {
    userId: user._id,
    type: args.type,
    statement: requireStatement(args.statement),
    body: args.body,
    confidence: 'hypothesis',
    confidenceOverridden: false,
    status: 'active',
    origin: args.origin,
    rev: 1,
  });
  await writeRevision(ctx, user, id, 1, 'Created', who);
  // Fire-and-forget embed (docs/spec/05-ai-pipeline.md §1 "embed" — trigger:
  // knowledge create/statement-change). Every new row has a statement, so this
  // always schedules (unlike patchKnowledge, which gates on what actually changed).
  await ctx.scheduler.runAfter(0, internal.ai.embed.run, {
    userId: user._id,
    targetType: 'knowledge',
    targetId: id,
  });
  return id;
}

export async function patchKnowledge(
  ctx: MutationCtx,
  user: Doc<'users'>,
  doc: Doc<'knowledge'>,
  patch: { statement?: string; body?: string; type?: KnowledgeType },
  reason: string,
  who: WriteActor,
): Promise<void> {
  const validReason = requireNonEmpty(reason, 'reason');
  const dbPatch: { statement?: string; body?: string; type?: KnowledgeType; rev: number } = {
    rev: doc.rev + 1,
  };
  if (patch.statement !== undefined) dbPatch.statement = requireStatement(patch.statement);
  if (patch.body !== undefined) dbPatch.body = patch.body;
  if (patch.type !== undefined) dbPatch.type = patch.type;
  if (Object.keys(dbPatch).length === 1) {
    throw new ConvexError({ code: 'invalid_input', message: 'patch must not be empty.' });
  }
  await ctx.db.patch(doc._id, dbPatch);
  await writeRevision(ctx, user, doc._id, dbPatch.rev, validReason, who);
  // Re-embed only when the embedded text (statement/body) actually changed — a
  // type-only patch doesn't touch what's embedded.
  if (patch.statement !== undefined || patch.body !== undefined) {
    await ctx.scheduler.runAfter(0, internal.ai.embed.run, {
      userId: user._id,
      targetType: 'knowledge',
      targetId: doc._id,
    });
  }
}

export async function archiveKnowledgeDoc(
  ctx: MutationCtx,
  user: Doc<'users'>,
  doc: Doc<'knowledge'>,
  reason: string,
  who: WriteActor,
): Promise<void> {
  const validReason = requireNonEmpty(reason, 'reason');
  const rev = doc.rev + 1;
  await ctx.db.patch(doc._id, { status: 'archived', rev });
  await writeRevision(ctx, user, doc._id, rev, validReason, who);
}

/**
 * Recompute suggested confidence after evidence changed (spec 03 §5).
 * Auto-applies only while confidenceOverridden is false; a label change is a
 * knowledge mutation, so it writes a revision (provenance invariant).
 */
export async function recomputeConfidence(
  ctx: MutationCtx,
  user: Doc<'users'>,
  knowledge: Doc<'knowledge'>,
  who: WriteActor,
): Promise<void> {
  const rows = await ctx.db
    .query('evidence')
    .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', knowledge._id))
    .collect();

  const duplicateOf: Record<string, string> = {};
  for (const row of rows) {
    if (row.sourceType !== 'entry') continue;
    const entryId = ctx.db.normalizeId('entries', row.sourceId);
    const entry = entryId === null ? null : await ctx.db.get(entryId);
    if (entry !== null && entry.userId === user._id && entry.duplicateOf !== undefined) {
      duplicateOf[entry._id] = entry.duplicateOf;
    }
  }

  const { suggested, supports, contradicts } = computeConfidence(
    rows.map(
      (row): EvidenceSource => ({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        stance: row.stance,
      }),
    ),
    duplicateOf,
  );

  if (knowledge.confidenceOverridden || suggested === knowledge.confidence) return;

  const rev = knowledge.rev + 1;
  await ctx.db.patch(knowledge._id, { confidence: suggested, rev });
  const updated = await ctx.db.get(knowledge._id);
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'knowledge',
    targetId: knowledge._id,
    rev,
    snapshot: knowledgeSnapshot(updated!),
    actor: who.actor,
    reason: `Confidence recomputed: ${knowledge.confidence} → ${suggested} (${supports} supporting, ${contradicts} contradicting)`,
    proposalId: who.proposalId,
  });
}

/** Link a source as evidence. Upserts on the unique (knowledge, source) pair. */
export async function upsertEvidence(
  ctx: MutationCtx,
  user: Doc<'users'>,
  knowledge: Doc<'knowledge'>,
  args: { sourceType: 'entry' | 'outcome'; sourceId: string; stance: Stance; note?: string; origin: 'user' | 'ai' },
  who: WriteActor,
): Promise<void> {
  const existing = await ctx.db
    .query('evidence')
    .withIndex('by_unique', (q) =>
      q
        .eq('userId', user._id)
        .eq('knowledgeId', knowledge._id)
        .eq('sourceType', args.sourceType)
        .eq('sourceId', args.sourceId),
    )
    .unique();
  if (existing !== null) {
    await ctx.db.patch(existing._id, { stance: args.stance, note: args.note });
  } else {
    await ctx.db.insert('evidence', {
      userId: user._id,
      knowledgeId: knowledge._id,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      stance: args.stance,
      note: args.note,
      origin: args.origin,
    });
  }
  await recomputeConfidence(ctx, user, knowledge, who);
}

/** Create a relationship edge. Both ends must already be assertOwner'd by the caller. */
export async function insertRelationship(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: { fromId: Id<'knowledge'>; toId: Id<'knowledge'>; kind: RelationshipKind; note?: string; origin: 'user' | 'ai' },
): Promise<void> {
  const fromRows = await ctx.db
    .query('relationships')
    .withIndex('by_from', (q) => q.eq('userId', user._id).eq('fromId', args.fromId))
    .collect();
  const duplicate = fromRows.some((row) => row.toId === args.toId && row.kind === args.kind);
  if (duplicate) return;
  await ctx.db.insert('relationships', {
    userId: user._id,
    fromId: args.fromId,
    toId: args.toId,
    kind: args.kind,
    note: args.note,
    origin: args.origin,
  });
}

export async function insertExperiment(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: {
    knowledgeId: Id<'knowledge'>;
    hypothesis: string;
    behavior: string;
    context: string;
    successCriteria: string;
    failureCriteria: string;
    observationTarget: string;
    origin: 'user' | 'ai';
  },
  who: WriteActor,
): Promise<Id<'experiments'>> {
  const id = await ctx.db.insert('experiments', {
    userId: user._id,
    knowledgeId: args.knowledgeId,
    hypothesis: args.hypothesis,
    behavior: args.behavior,
    context: args.context,
    successCriteria: args.successCriteria,
    failureCriteria: args.failureCriteria,
    observationTarget: args.observationTarget,
    status: 'draft',
    origin: args.origin,
    rev: 1,
  });
  const doc = assertOwner(await ctx.db.get(id), user);
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'experiment',
    targetId: id,
    rev: 1,
    snapshot: experimentSnapshot(doc),
    actor: who.actor,
    reason: 'Created',
    proposalId: who.proposalId,
  });
  return id;
}
