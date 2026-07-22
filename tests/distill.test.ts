/// <reference types="vite/client" />
// TDD for the distill action (Phase 3a Task 6, docs/spec/05-ai-pipeline.md §1/§3):
// stub-provider loop -> pending proposal + ok aiRun; re-distill supersedes
// (AC-3.5); budget refusal (AC-3.4); trivial-empty path; distillStatus mapping.
//
// AI_PROVIDER=stub must be set before any convex module import (the action reads
// process.env at call time, but we set it up front for clarity and parity with
// the other AI test files).
process.env.AI_PROVIDER = 'stub';

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import { stripNulls } from '../convex/ai/distill';
import { DISTILL_MODEL } from '../convex/ai/models';
import { DISTILL_PROMPT_VERSION } from '../convex/ai/prompts/distill';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

type World = TestConvex<typeof schema>;
type AsUser = ReturnType<World['withIdentity']>;

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
  return { t, asA, userId: userId as Id<'users'> };
}

async function createEntry(asA: AsUser, body: string) {
  return await asA.mutation(api.entries.create, { kind: 'journal', body, occurredAt: 1000 });
}

// env vars are process.env in convex-test — save/restore around any test that
// mutates AI_DAILY_TOKEN_BUDGET to avoid leaking state into later tests.
const ORIGINAL_BUDGET_ENV = process.env.AI_DAILY_TOKEN_BUDGET;
afterEach(() => {
  if (ORIGINAL_BUDGET_ENV === undefined) delete process.env.AI_DAILY_TOKEN_BUDGET;
  else process.env.AI_DAILY_TOKEN_BUDGET = ORIGINAL_BUDGET_ENV;
});

describe('stripNulls', () => {
  it('removes every key whose value is null, recursively, leaving other keys intact', () => {
    const input = {
      op: 'createKnowledge',
      type: 'observation',
      statement: 's',
      body: null,
    };
    expect(stripNulls(input)).toEqual({ op: 'createKnowledge', type: 'observation', statement: 's' });
  });

  it('recurses into arrays and nested objects', () => {
    const input = {
      ops: [
        { op: 'createKnowledge', type: 'observation', statement: 's', body: null },
        {
          op: 'updateKnowledge',
          target: { kind: 'existing', id: 'k1' },
          patch: { statement: 'x', body: null, type: null },
          reason: 'r',
        },
      ],
      rationale: 'r',
      citations: [{ excerpt: 'e', extra: null }],
    };
    expect(stripNulls(input)).toEqual({
      ops: [
        { op: 'createKnowledge', type: 'observation', statement: 's' },
        {
          op: 'updateKnowledge',
          target: { kind: 'existing', id: 'k1' },
          patch: { statement: 'x' },
          reason: 'r',
        },
      ],
      rationale: 'r',
      citations: [{ excerpt: 'e' }],
    });
  });

  it('passes through primitives, arrays of primitives, and non-null values unchanged', () => {
    expect(stripNulls('s')).toBe('s');
    expect(stripNulls(5)).toBe(5);
    expect(stripNulls(null)).toBeNull();
    expect(stripNulls([1, null, 'a'])).toEqual([1, null, 'a']);
  });
});

describe('distill.run (stub provider)', () => {
  it('produces a pending proposal with citations and an ok aiRun carrying the proposalId', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'I noticed I get defensive in code review.');

    await t.action(internal.ai.distill.run, { userId, entryId });

    const proposals = await asA.query(api.proposals.list, {});
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.source).toBe('distillation');
    expect(proposals[0]?.entryId).toBe(entryId);
    expect(proposals[0]?.citations).toEqual([
      { sourceType: 'entry', sourceId: entryId, excerpt: 'I noticed I get defensive in code review.' },
    ]);
    expect(proposals[0]?.ops).toHaveLength(1);

    const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
    const runRow = await t.run(async (ctx) =>
      ctx.db
        .query('aiRuns')
        .withIndex('by_runId', (q) => q.eq('runId', runId))
        .unique(),
    );
    expect(runRow?.status).toBe('ok');
    expect(runRow?.model).toBe(DISTILL_MODEL);
    expect(runRow?.proposalId).toBe(proposals[0]?._id);

    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('proposed');
  });

  it('re-distilling the same entry supersedes the prior pending proposal (AC-3.5)', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'Same entry, distilled twice.');

    await t.action(internal.ai.distill.run, { userId, entryId });
    const first = await asA.query(api.proposals.list, {});
    expect(first).toHaveLength(1);

    await t.action(internal.ai.distill.run, { userId, entryId });
    const second = await asA.query(api.proposals.list, {});
    expect(second).toHaveLength(1);
    expect(second[0]?._id).not.toBe(first[0]?._id);

    const firstDoc = await t.run(async (ctx) => ctx.db.get(first[0]!._id));
    expect(firstDoc?.status).toBe('superseded');

    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('proposed');
  });

  it('budget 0 refuses before any provider call: no proposal, error aiRun, distillStatus budget (AC-3.4)', async () => {
    process.env.AI_DAILY_TOKEN_BUDGET = '0';
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'This should never be distilled.');

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(await asA.query(api.proposals.list, {})).toEqual([]);

    const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
    const runRow = await t.run(async (ctx) =>
      ctx.db
        .query('aiRuns')
        .withIndex('by_runId', (q) => q.eq('runId', runId))
        .unique(),
    );
    expect(runRow?.status).toBe('error');
    expect(runRow?.error).toBe('budget');

    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('budget');
  });

  it("body exactly 'skip' produces no ops and no proposal; distillStatus is empty", async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'skip');

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(await asA.query(api.proposals.list, {})).toEqual([]);
    const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
    const runRow = await t.run(async (ctx) =>
      ctx.db
        .query('aiRuns')
        .withIndex('by_runId', (q) => q.eq('runId', runId))
        .unique(),
    );
    expect(runRow?.status).toBe('ok');
    expect(runRow?.proposalId).toBeUndefined();

    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('empty');
  });
});

describe('entries.distillStatus mapping', () => {
  it("returns 'none' when no distill run exists for the entry", async () => {
    const { asA } = await provisioned();
    const entryId = await createEntry(asA, 'never distilled');
    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('none');
  });

  it("returns 'running' while the aiRun row is still in progress", async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'in flight');
    const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
    await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId,
      model: DISTILL_MODEL,
      promptVersion: DISTILL_PROMPT_VERSION,
    });
    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('running');
  });

  it("returns 'error' for a non-budget error", async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'went wrong');
    const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
    const id = await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId,
      model: DISTILL_MODEL,
      promptVersion: DISTILL_PROMPT_VERSION,
    });
    await t.mutation(internal.internal.aiRuns.finish, { id, status: 'error', error: 'invalid_output' });
    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('error');
  });
});
