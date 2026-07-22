/// <reference types="vite/client" />
// TDD for convex/internal/aiRuns.ts (Phase 3a Task 5): start/finish roundtrip,
// runId idempotence, and spentToday's window + status + user scoping.
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };
const USER_B = { subject: 'clerk_user_b', name: 'User B' };

const DAY_MS = 24 * 60 * 60 * 1000;

async function provisionedUser(t: TestConvex<typeof schema>, identity: { subject: string; name: string }) {
  const as = t.withIdentity(identity);
  await as.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .unique();
    return user!._id;
  });
  return userId as Id<'users'>;
}

describe('aiRuns.start / finish', () => {
  it('start inserts a running row; finish patches it to ok with token counts', async () => {
    const t = convexTest(schema, modules);
    const userId = await provisionedUser(t, USER_A);

    const id = await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId: 'distill:e1:v1',
      model: 'stub',
      promptVersion: 'v1',
    });

    let row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe('running');
    expect(row?.userId).toBe(userId);

    await t.mutation(internal.internal.aiRuns.finish, {
      id,
      status: 'ok',
      inputTokens: 100,
      outputTokens: 50,
    });

    row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe('ok');
    expect(row?.inputTokens).toBe(100);
    expect(row?.outputTokens).toBe(50);
  });

  it('a second finish() that omits token counts does not wipe tokens set by the first (undefined-key patch guard)', async () => {
    const t = convexTest(schema, modules);
    const userId = await provisionedUser(t, USER_A);

    const id = await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId: 'distill:e-late-proposal:v1',
      model: 'stub',
      promptVersion: 'v1',
    });

    await t.mutation(internal.internal.aiRuns.finish, {
      id,
      status: 'ok',
      inputTokens: 100,
      outputTokens: 50,
    });

    const proposalId = await t.mutation(internal.internal.proposalStore.upsertProposal, {
      userId,
      source: 'distillation',
      ops: [{ op: 'createKnowledge', type: 'insight', statement: 'Late-attached proposal' }],
      rationale: 'because the stub said so',
      citations: [],
      model: 'stub',
      promptVersion: 'v1',
    });

    // Later call attaches only a proposalId; must not clear the token counts.
    await t.mutation(internal.internal.aiRuns.finish, {
      id,
      status: 'ok',
      proposalId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe('ok');
    expect(row?.inputTokens).toBe(100);
    expect(row?.outputTokens).toBe(50);
    expect(row?.proposalId).toBe(proposalId);
  });

  it('finish can record an error status with a message and no tokens', async () => {
    const t = convexTest(schema, modules);
    const userId = await provisionedUser(t, USER_A);

    const id = await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId: 'distill:e2:v1',
      model: 'stub',
      promptVersion: 'v1',
    });
    await t.mutation(internal.internal.aiRuns.finish, {
      id,
      status: 'error',
      error: 'budget',
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe('error');
    expect(row?.error).toBe('budget');
  });

  it('a repeated runId patches the same row back to running and clears a prior error (idempotence)', async () => {
    const t = convexTest(schema, modules);
    const userId = await provisionedUser(t, USER_A);
    const runId = 'distill:e3:v1';

    const firstId = await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId,
      model: 'stub',
      promptVersion: 'v1',
    });
    await t.mutation(internal.internal.aiRuns.finish, {
      id: firstId,
      status: 'error',
      error: 'boom',
    });

    const secondId = await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId,
      model: 'stub',
      promptVersion: 'v1',
    });

    expect(secondId).toBe(firstId);
    const row = await t.run(async (ctx) => ctx.db.get(secondId));
    expect(row?.status).toBe('running');
    expect(row?.error).toBeUndefined();

    const all = await t.run(async (ctx) => ctx.db.query('aiRuns').collect());
    expect(all).toHaveLength(1);
  });

  it('a runId collision across users throws (defense in depth on the global by_runId index)', async () => {
    const t = convexTest(schema, modules);
    const userIdA = await provisionedUser(t, USER_A);
    const userIdB = await provisionedUser(t, USER_B);
    const runId = 'distill:shared:v1';

    await t.mutation(internal.internal.aiRuns.start, {
      userId: userIdA,
      purpose: 'distill',
      runId,
      model: 'stub',
      promptVersion: 'v1',
    });

    await expect(
      t.mutation(internal.internal.aiRuns.start, {
        userId: userIdB,
        purpose: 'distill',
        runId,
        model: 'stub',
        promptVersion: 'v1',
      }),
    ).rejects.toThrow();
  });
});

describe('aiRuns.spentToday', () => {
  it('sums input+output tokens of ok AND error runs (a failed live call still billed those tokens and must count against budget), scopes to the window and the user', async () => {
    const t = convexTest(schema, modules);
    const userIdA = await provisionedUser(t, USER_A);
    const userIdB = await provisionedUser(t, USER_B);
    const nowMs = Date.now();

    const okId = await t.mutation(internal.internal.aiRuns.start, {
      userId: userIdA,
      purpose: 'distill',
      runId: 'a:ok',
      model: 'stub',
      promptVersion: 'v1',
    });
    await t.mutation(internal.internal.aiRuns.finish, {
      id: okId,
      status: 'ok',
      inputTokens: 100,
      outputTokens: 25,
    });

    const errorId = await t.mutation(internal.internal.aiRuns.start, {
      userId: userIdA,
      purpose: 'distill',
      runId: 'a:error',
      model: 'stub',
      promptVersion: 'v1',
    });
    await t.mutation(internal.internal.aiRuns.finish, {
      id: errorId,
      status: 'error',
      inputTokens: 9000,
      outputTokens: 9000,
      error: 'should count — the tokens were still billed',
    });

    const otherUserId = await t.mutation(internal.internal.aiRuns.start, {
      userId: userIdB,
      purpose: 'distill',
      runId: 'b:ok',
      model: 'stub',
      promptVersion: 'v1',
    });
    await t.mutation(internal.internal.aiRuns.finish, {
      id: otherUserId,
      status: 'ok',
      inputTokens: 500,
      outputTokens: 500,
    });

    const spentA = await t.query(internal.internal.aiRuns.spentToday, { userId: userIdA, nowMs });
    expect(spentA).toBe(125 + 18000);

    const spentB = await t.query(internal.internal.aiRuns.spentToday, { userId: userIdB, nowMs });
    expect(spentB).toBe(1000);

    // A window that can't contain "now" (two days out) excludes everything.
    const spentOutsideWindow = await t.query(internal.internal.aiRuns.spentToday, {
      userId: userIdA,
      nowMs: nowMs + 2 * DAY_MS,
    });
    expect(spentOutsideWindow).toBe(0);
  });

  it('running (not yet finished) runs contribute 0 tokens since none are recorded yet', async () => {
    const t = convexTest(schema, modules);
    const userId = await provisionedUser(t, USER_A);
    const nowMs = Date.now();

    await t.mutation(internal.internal.aiRuns.start, {
      userId,
      purpose: 'distill',
      runId: 'a:running',
      model: 'stub',
      promptVersion: 'v1',
    });

    const spent = await t.query(internal.internal.aiRuns.spentToday, { userId, nowMs });
    expect(spent).toBe(0);
  });
});
