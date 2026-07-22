/// <reference types="vite/client" />
// TDD for Phase M Task 2 (Distill honesty rework, docs/spec/adr/0012 + 05-ai-pipeline.md
// §1/§3): the live path with no OPENAI_API_KEY configured must finish with a distinct
// 'no_provider' error — WITHOUT ever calling the provider — using the exact same
// start()/finish() discipline as the budget-refusal path, and distillStatus must map
// that to a new 'unavailable' literal (not the generic 'error' bucket).
//
// AI_PROVIDER must NOT be 'stub' and OPENAI_API_KEY must be unset before any convex
// module import, so distill.ts takes the live branch and immediately hits the
// no-key guard (mirrors distill-live.test.ts's env setup, inverted).
delete process.env.AI_PROVIDER;
delete process.env.OPENAI_API_KEY;

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import { DISTILL_PROMPT_VERSION } from '../convex/ai/prompts/distill';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

// If the guard regresses and the live branch is ever reached, this mock would
// be exercised — asserting it's never called is the "no provider call" proof.
const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create: createMock };
  },
}));

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

describe('distill.run (live path, no OPENAI_API_KEY configured)', () => {
  it('finishes error "no_provider" with no proposal and no provider call (AC: honest unavailable state)', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'This should never reach the provider.');

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(createMock).not.toHaveBeenCalled();
    expect(await asA.query(api.proposals.list, {})).toEqual([]);

    const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
    const runRow = await t.run(async (ctx) =>
      ctx.db
        .query('aiRuns')
        .withIndex('by_runId', (q) => q.eq('runId', runId))
        .unique(),
    );
    expect(runRow?.status).toBe('error');
    expect(runRow?.error).toBe('no_provider');

    expect(await asA.query(api.entries.distillStatus, { id: entryId })).toBe('unavailable');
  });
});
