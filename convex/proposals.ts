// The review queue's engine (docs/spec/03 §7, 05 §3, AC-3.2/3.3/3.5). `resolve`
// is the ONLY writer of AI-approved knowledge mutations — a single mutation that
// plans (pure lib), then applies via the same domain write helpers user-initiated
// mutations use (convex/ops/knowledgeWrites.ts), stamped { actor: 'ai-approved' }.
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { planApplication, type OpResolution } from './lib/applyPlan';
import { assertOwner, currentUser, requireUser } from './lib/auth';
import {
  archiveKnowledgeDoc,
  insertExperiment,
  insertKnowledge,
  insertRelationship,
  patchKnowledge,
  upsertEvidence,
  type WriteActor,
} from './ops/knowledgeWrites';
import { proposalOpValidator, validateOps, type OpRef, type ProposalOp } from './shared/proposalOps';

const opResolutionValidator = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('edited'),
);

/** Pending proposals for the review queue, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('proposals')
      .withIndex('by_user_status', (q) => q.eq('userId', user._id).eq('status', 'pending'))
      .order('desc')
      .collect();

    const result = [];
    for (const p of rows) {
      const entry = p.entryId !== undefined ? await ctx.db.get(p.entryId) : null;
      const entryExcerpt = entry !== null && entry.userId === user._id ? entry.body.slice(0, 140) : undefined;
      result.push({
        _id: p._id,
        source: p.source,
        rationale: p.rationale,
        entryId: p.entryId,
        entryExcerpt,
        citations: p.citations,
        ops: p.ops,
        opResolutions: p.opResolutions,
        _creationTime: p._creationTime,
      });
    }
    return result;
  },
});

/** The newest non-superseded proposal for an entry, or null — drives the Distill button state. */
export const forEntry = query({
  args: { entryId: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    assertOwner(await ctx.db.get(args.entryId), user);

    const rows = await ctx.db
      .query('proposals')
      .withIndex('by_user_status', (q) => q.eq('userId', user._id))
      .collect();
    const candidates = rows.filter((p) => p.entryId === args.entryId && p.status !== 'superseded');
    if (candidates.length === 0) return null;
    const newest = candidates.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
    return { _id: newest._id, status: newest.status };
  },
});

/** Pending count for the nav badge — 0 when signed out/unprovisioned, never throws. */
export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (user === null) return 0;
    const rows = await ctx.db
      .query('proposals')
      .withIndex('by_user_status', (q) => q.eq('userId', user._id).eq('status', 'pending'))
      .collect();
    return rows.length;
  },
});

/**
 * Resolve a proposal in ONE mutation: plan the application (pure lib, dependency
 * refusal), then apply the approved/edited subset via the domain write helpers,
 * finally marking the proposal resolved. Every write is stamped
 * { actor: 'ai-approved', proposalId } / origin 'ai' (AC-3.2 provenance).
 */
export const resolve = mutation({
  args: {
    id: v.id('proposals'),
    resolutions: v.array(opResolutionValidator),
    editedOps: v.array(v.union(v.null(), proposalOpValidator)),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const proposal = assertOwner(await ctx.db.get(args.id), user);
    if (proposal.status !== 'pending') {
      throw new ConvexError({ code: 'invalid_state', message: 'Proposal is not pending.' });
    }

    const ops = proposal.ops as ProposalOp[]; // validated at upsertProposal write time
    if (ops.length !== args.resolutions.length || ops.length !== args.editedOps.length) {
      throw new ConvexError({
        code: 'invalid_input',
        message: 'resolutions and editedOps must match the proposal’s op count.',
      });
    }

    // Carry-forward obligation 1: an edited op must keep its original kind — a kind
    // flip would silently re-target refs meant for the original op's shape.
    for (let i = 0; i < ops.length; i++) {
      if (args.resolutions[i] !== 'edited') continue;
      const edited = args.editedOps[i];
      if (edited == null || edited.op !== ops[i]!.op) {
        throw new ConvexError({ code: 'invalid_input', message: 'edited op must keep its kind' });
      }
    }

    // Carry-forward obligation 2: the effective op list (edited ops substituted in)
    // must pass validateOps — the arg validator only enforces shape, not semantics.
    const effectiveOps: ProposalOp[] = ops.map((op, i) =>
      args.resolutions[i] === 'edited' ? args.editedOps[i]! : op,
    );
    const verdicts = validateOps(effectiveOps);
    const invalidVerdict = verdicts.find((verdict) => !verdict.valid);
    if (invalidVerdict) {
      throw new ConvexError({ code: 'invalid_input', message: invalidVerdict.error });
    }

    const plan = planApplication(ops, args.resolutions as OpResolution[], args.editedOps as Array<ProposalOp | null>);
    if (!plan.ok) {
      throw new ConvexError({ code: 'dependency', message: plan.error });
    }

    const who: WriteActor = { actor: 'ai-approved', proposalId: args.id };
    const createdKnowledgeIds: Id<'knowledge'>[] = [];

    async function resolveKnowledgeRef(ref: OpRef): Promise<Doc<'knowledge'>> {
      if (ref.kind === 'existing') {
        const knowledgeId = ctx.db.normalizeId('knowledge', ref.id);
        return assertOwner(knowledgeId === null ? null : await ctx.db.get(knowledgeId), user);
      }
      const appliedIndex = plan.ok ? plan.newIndexMap.get(ref.index) : undefined;
      const knowledgeId = appliedIndex === undefined ? undefined : createdKnowledgeIds[appliedIndex];
      if (knowledgeId === undefined) {
        throw new ConvexError({
          code: 'dependency',
          message: `unresolved reference to new object #${ref.index}`,
        });
      }
      return assertOwner(await ctx.db.get(knowledgeId), user);
    }

    for (const { op } of plan.toApply) {
      switch (op.op) {
        case 'createKnowledge': {
          const id = await insertKnowledge(
            ctx,
            user,
            { type: op.type, statement: op.statement, body: op.body, origin: 'ai' },
            who,
          );
          createdKnowledgeIds.push(id);
          break;
        }
        case 'addEvidence': {
          const knowledge = await resolveKnowledgeRef(op.knowledge);
          if (op.sourceType === 'entry') {
            const entryId = ctx.db.normalizeId('entries', op.sourceId);
            assertOwner(entryId === null ? null : await ctx.db.get(entryId), user);
          }
          await upsertEvidence(
            ctx,
            user,
            knowledge,
            {
              sourceType: op.sourceType,
              sourceId: op.sourceId,
              stance: op.stance,
              note: op.note,
              origin: 'ai',
            },
            who,
          );
          break;
        }
        case 'updateKnowledge': {
          const doc = await resolveKnowledgeRef(op.target);
          await patchKnowledge(ctx, user, doc, op.patch, op.reason, who);
          break;
        }
        case 'archiveKnowledge': {
          const doc = await resolveKnowledgeRef(op.target);
          await archiveKnowledgeDoc(ctx, user, doc, op.reason, who);
          break;
        }
        case 'createRelationship': {
          const fromDoc = await resolveKnowledgeRef(op.from);
          const toDoc = await resolveKnowledgeRef(op.to);
          await insertRelationship(ctx, user, {
            fromId: fromDoc._id,
            toId: toDoc._id,
            kind: op.kind,
            note: op.note,
            origin: 'ai',
          });
          break;
        }
        case 'createExperiment': {
          const knowledge = await resolveKnowledgeRef(op.knowledge);
          await insertExperiment(
            ctx,
            user,
            {
              knowledgeId: knowledge._id,
              hypothesis: op.hypothesis,
              behavior: op.behavior,
              context: op.context,
              successCriteria: op.successCriteria,
              failureCriteria: op.failureCriteria,
              observationTarget: op.observationTarget,
              origin: 'ai',
            },
            who,
          );
          break;
        }
      }
    }

    await ctx.db.patch(args.id, {
      status: 'resolved',
      opResolutions: args.resolutions,
      resolvedAt: Date.now(),
    });
    return null;
  },
});
