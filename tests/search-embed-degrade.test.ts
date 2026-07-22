/// <reference types="vite/client" />
// TDD for reviewer fix #2 (hybridSearch's live-path query-embedding failure):
// a thrown provider error embedding the QUERY (as opposed to the "no key
// configured" null path, already covered by convex/ai/search.ts's other branch)
// must degrade to text-only results, not propagate as an uncaught hybridSearch
// failure. Mocks the `openai` package entirely; never hits the network.
//
// AI_PROVIDER must NOT be 'stub' and OPENAI_API_KEY must be set before any
// convex module import, so ai/search.ts's embedQuery takes the live branch
// (mirrors distill-live.test.ts's env setup).
process.env.OPENAI_API_KEY = 'test-key';
delete process.env.AI_PROVIDER;

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const embeddingsCreateMock = vi.fn(() => {
  throw new Error('provider outage');
});

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = { create: embeddingsCreateMock };
  },
}));

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

type World = TestConvex<typeof schema>;

async function provisioned(t: World) {
  const as = t.withIdentity(USER_A);
  await as.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', USER_A.subject))
      .unique();
    return user!._id;
  });
  return { as, userId: userId as Id<'users'> };
}

describe('ai.search.hybridSearch (live path, query embedding throws)', () => {
  it('degrades to text-only results instead of throwing', async () => {
    const t = convexTest(schema, modules);
    const { as, userId } = await provisioned(t);

    const knowledgeId = await as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'a distinctive phrase for text-only fallback',
    });

    const results = await t.action(internal.ai.search.hybridSearch, {
      userId,
      query: 'distinctive phrase',
      limit: 10,
      scope: 'knowledge',
    });

    expect(embeddingsCreateMock).toHaveBeenCalled();
    expect(Array.isArray(results)).toBe(true);
    expect(results.map((r) => r.id)).toContain(knowledgeId);
    expect(results.every((r) => r.objectType === 'knowledge')).toBe(true);
  });
});
