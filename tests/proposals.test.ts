/// <reference types="vite/client" />
// TDD for the review queue's engine (Phase 3a Task 4, docs/spec/03 §7, 05 §3,
// AC-3.2/3.3/3.5). Seeds proposals via the internal upsert (the distill action's
// entry point in a later task); exercises proposals.list/forEntry/pendingCount/resolve
// as the public surface.
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import type { ProposalOp } from '../convex/shared/proposalOps';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

type World = ReturnType<typeof convexTest>;

async function provisioned() {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity(USER_A);
  await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', USER_A.subject))
      .unique();
    return user!._id;
  });
  return { t, asA, userId };
}

async function seedProposal(
  t: World,
  userId: Id<'users'>,
  overrides: Partial<{
    ops: ProposalOp[];
    entryId: Id<'entries'>;
    runId: string;
    source: 'distillation' | 'connection' | 'outcome' | 'mcp' | 'review';
  }> = {},
) {
  return await t.mutation(internal.internal.proposalStore.upsertProposal, {
    userId,
    source: overrides.source ?? 'distillation',
    entryId: overrides.entryId,
    runId: overrides.runId,
    ops: overrides.ops ?? [{ op: 'createKnowledge', type: 'insight', statement: 'Stub insight' }],
    rationale: 'because the stub said so',
    citations: [{ sourceType: 'entry', sourceId: 'e1', excerpt: 'excerpt text' }],
    model: 'stub',
    promptVersion: 'v1',
  });
}

describe('proposals.resolve', () => {
  it('approve-all creates knowledge with origin ai and a revision stamped ai-approved (AC-3.2)', async () => {
    const { t, asA, userId } = await provisioned();
    const proposalId = await seedProposal(t, userId);

    await asA.mutation(api.proposals.resolve, {
      id: proposalId,
      resolutions: ['approved'],
      editedOps: [null],
    });

    const list = await asA.query(api.knowledge.list, {});
    expect(list).toHaveLength(1);
    expect(list[0]?.statement).toBe('Stub insight');

    const detail = await asA.query(api.knowledge.get, { id: list[0]!._id });
    expect(detail.origin).toBe('ai');
    expect(detail.revisions[0]?.actor).toBe('ai-approved');
    expect(detail.revisions[0]?.reason).toBe('Created');

    const revisionRow = await t.run(async (ctx) =>
      ctx.db
        .query('revisions')
        .withIndex('by_target', (q) =>
          q.eq('userId', userId).eq('targetType', 'knowledge').eq('targetId', list[0]!._id),
        )
        .first(),
    );
    expect(revisionRow?.proposalId).toBe(proposalId);

    const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
    expect(proposal?.status).toBe('resolved');
    expect(proposal?.opResolutions).toEqual(['approved']);
    expect(proposal?.resolvedAt).toBeTypeOf('number');
  });

  it('reject-all writes nothing but records resolutions + resolved status', async () => {
    const { t, asA, userId } = await provisioned();
    const proposalId = await seedProposal(t, userId);

    await asA.mutation(api.proposals.resolve, {
      id: proposalId,
      resolutions: ['rejected'],
      editedOps: [null],
    });

    expect(await asA.query(api.knowledge.list, {})).toEqual([]);
    const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
    expect(proposal?.status).toBe('resolved');
    expect(proposal?.opResolutions).toEqual(['rejected']);
  });

  it('applies exactly the approved/edited subset in one call, and addEvidence on a new-ref recomputes confidence (hypothesis -> tentative)', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await asA.mutation(api.entries.create, {
      kind: 'journal',
      body: 'evidence entry',
      occurredAt: 1000,
    });

    const ops: ProposalOp[] = [
      { op: 'createKnowledge', type: 'insight', statement: 'Kept via approve' },
      { op: 'createKnowledge', type: 'insight', statement: 'Original edited statement' },
      {
        op: 'addEvidence',
        knowledge: { kind: 'new', index: 0 },
        sourceType: 'entry',
        sourceId: entryId,
        stance: 'supports',
      },
      { op: 'createKnowledge', type: 'insight', statement: 'Rejected create' },
    ];
    const proposalId = await seedProposal(t, userId, { ops });

    const editedOp: ProposalOp = { op: 'createKnowledge', type: 'insight', statement: 'Edited statement' };
    await asA.mutation(api.proposals.resolve, {
      id: proposalId,
      resolutions: ['approved', 'edited', 'approved', 'rejected'],
      editedOps: [null, editedOp, null, null],
    });

    const list = await asA.query(api.knowledge.list, {});
    expect(list).toHaveLength(2);
    const statements = list.map((k) => k.statement).sort();
    expect(statements).toEqual(['Edited statement', 'Kept via approve']);

    const kept = list.find((k) => k.statement === 'Kept via approve')!;
    expect(kept.confidence).toBe('tentative');
    expect(kept.supports).toBe(1);

    const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
    expect(proposal?.status).toBe('resolved');
    expect(proposal?.opResolutions).toEqual(['approved', 'edited', 'approved', 'rejected']);
  });

  it('dependency refusal surfaces a ConvexError and leaves the proposal pending (AC-3.3)', async () => {
    const { t, asA, userId } = await provisioned();
    const ops: ProposalOp[] = [
      { op: 'createKnowledge', type: 'insight', statement: 'Will be rejected' },
      {
        op: 'addEvidence',
        knowledge: { kind: 'new', index: 0 },
        sourceType: 'entry',
        sourceId: 'placeholder',
        stance: 'supports',
      },
    ];
    const proposalId = await seedProposal(t, userId, { ops });

    await expect(
      asA.mutation(api.proposals.resolve, {
        id: proposalId,
        resolutions: ['rejected', 'approved'],
        editedOps: [null, null],
      }),
    ).rejects.toThrow(ConvexError);

    expect(await asA.query(api.knowledge.list, {})).toEqual([]);
    const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
    expect(proposal?.status).toBe('pending');
  });

  it('refuses an edited op that changes kind, before planApplication runs (carry-forward obligation 1)', async () => {
    const { t, asA, userId } = await provisioned();
    const proposalId = await seedProposal(t, userId, {
      ops: [{ op: 'createKnowledge', type: 'insight', statement: 'Original' }],
    });

    const flippedKind: ProposalOp = {
      op: 'archiveKnowledge',
      target: { kind: 'existing', id: 'k1' },
      reason: 'sneaky kind flip',
    };

    await expect(
      asA.mutation(api.proposals.resolve, {
        id: proposalId,
        resolutions: ['edited'],
        editedOps: [flippedKind],
      }),
    ).rejects.toThrow('edited op must keep its kind');

    const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
    expect(proposal?.status).toBe('pending');
    expect(await asA.query(api.knowledge.list, {})).toEqual([]);
  });

  it('refuses an edited op that fails validateOps even though the kind matches (carry-forward obligation 2)', async () => {
    const { t, asA, userId } = await provisioned();
    const proposalId = await seedProposal(t, userId, {
      ops: [{ op: 'createKnowledge', type: 'insight', statement: 'Original' }],
    });

    const invalidEdit: ProposalOp = { op: 'createKnowledge', type: 'insight', statement: '' };

    await expect(
      asA.mutation(api.proposals.resolve, {
        id: proposalId,
        resolutions: ['edited'],
        editedOps: [invalidEdit],
      }),
    ).rejects.toThrow();

    const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
    expect(proposal?.status).toBe('pending');
    expect(await asA.query(api.knowledge.list, {})).toEqual([]);
  });

  it('throws when resolving a non-pending proposal', async () => {
    const { t, asA, userId } = await provisioned();
    const proposalId = await seedProposal(t, userId);
    await asA.mutation(api.proposals.resolve, {
      id: proposalId,
      resolutions: ['approved'],
      editedOps: [null],
    });

    await expect(
      asA.mutation(api.proposals.resolve, {
        id: proposalId,
        resolutions: ['approved'],
        editedOps: [null],
      }),
    ).rejects.toThrow();
  });
});

describe('proposals.upsertProposal (internal) supersession — AC-3.5', () => {
  it('re-upserting for the same entry+source supersedes the prior pending proposal; list shows only the new one', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await asA.mutation(api.entries.create, {
      kind: 'journal',
      body: 'distilled entry',
      occurredAt: 1000,
    });

    const first = await seedProposal(t, userId, { entryId, runId: 'run1' });
    const second = await seedProposal(t, userId, { entryId, runId: 'run2' });

    const list = await asA.query(api.proposals.list, {});
    expect(list).toHaveLength(1);
    expect(list[0]?._id).toBe(second);
    expect(list[0]?.entryExcerpt).toBe('distilled entry');

    const firstDoc = await t.run(async (ctx) => ctx.db.get(first));
    expect(firstDoc?.status).toBe('superseded');
  });
});

describe('proposals.forEntry', () => {
  it('returns the newest non-superseded proposal for an entry', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await asA.mutation(api.entries.create, {
      kind: 'journal',
      body: 'entry body',
      occurredAt: 1000,
    });
    await seedProposal(t, userId, { entryId, runId: 'r1' });
    const second = await seedProposal(t, userId, { entryId, runId: 'r2' });

    const result = await asA.query(api.proposals.forEntry, { entryId });
    expect(result).toEqual({ _id: second, status: 'pending' });
  });

  it('returns null when no proposal exists for the entry', async () => {
    const { asA } = await provisioned();
    const entryId = await asA.mutation(api.entries.create, {
      kind: 'journal',
      body: 'no proposal here',
      occurredAt: 1000,
    });
    expect(await asA.query(api.proposals.forEntry, { entryId })).toBeNull();
  });
});

describe('proposals.pendingCount', () => {
  it('counts only pending proposals, and is 0 when signed out', async () => {
    const { t, asA, userId } = await provisioned();
    await seedProposal(t, userId);
    await seedProposal(t, userId);

    expect(await asA.query(api.proposals.pendingCount, {})).toBe(2);
    expect(await t.query(api.proposals.pendingCount, {})).toBe(0);
  });
});
