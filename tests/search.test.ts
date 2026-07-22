/// <reference types="vite/client" />
// TDD for the hybrid search seam (Phase M Task 3, docs/spec/05-ai-pipeline.md §1
// "ask"; plan's vector-search-in-actions design note):
//   - convex/internal/searchText.ts: userId-scoped text search + hydration queries
//     (called directly here to prove isolation independent of the action).
//   - convex/ai/search.ts's hybridSearch: fuses vector (ctx.vectorSearch, userId
//     filter) + text (searchText) via lib/retrieval's mergeRanked.
process.env.AI_PROVIDER = 'stub';

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };
const USER_B = { subject: 'clerk_user_b', name: 'User B' };

type World = TestConvex<typeof schema>;

async function provisionedUser(t: World, identity: { subject: string; name: string }) {
  const as = t.withIdentity(identity);
  await as.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .unique();
    return user!._id;
  });
  return { as, userId: userId as Id<'users'> };
}

describe('internal/searchText userId scoping', () => {
  it('searchKnowledge never returns another user\'s matching rows', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const b = await provisionedUser(t, USER_B);

    const aId = await a.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'shared keyword alpha',
    });
    const bId = await b.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'shared keyword beta',
    });

    const asAResults = await t.query(internal.internal.searchText.searchKnowledge, {
      userId: a.userId,
      query: 'shared keyword',
      limit: 10,
    });
    expect(asAResults.map((r) => r.id)).toEqual([aId]);
    expect(asAResults.map((r) => r.id)).not.toContain(bId);

    const asBResults = await t.query(internal.internal.searchText.searchKnowledge, {
      userId: b.userId,
      query: 'shared keyword',
      limit: 10,
    });
    expect(asBResults.map((r) => r.id)).toEqual([bId]);
  });

  it('searchEntries never returns another user\'s matching rows', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const b = await provisionedUser(t, USER_B);

    const aId = await a.as.mutation(api.entries.create, {
      kind: 'journal',
      body: 'overlapping search term one',
      occurredAt: 1,
    });
    await b.as.mutation(api.entries.create, {
      kind: 'journal',
      body: 'overlapping search term two',
      occurredAt: 1,
    });

    const asAResults = await t.query(internal.internal.searchText.searchEntries, {
      userId: a.userId,
      query: 'overlapping search',
      limit: 10,
    });
    expect(asAResults.map((r) => r.id)).toEqual([aId]);
  });

  it('hydrateKnowledge/hydrateEntries silently drop ids belonging to another user', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const b = await provisionedUser(t, USER_B);

    const bKnowledgeId = await b.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: "b's private knowledge",
    });
    const bEntryId = await b.as.mutation(api.entries.create, {
      kind: 'journal',
      body: "b's private entry",
      occurredAt: 1,
    });

    const knowledgeRows = await t.query(internal.internal.searchText.hydrateKnowledge, {
      userId: a.userId,
      ids: [bKnowledgeId],
    });
    expect(knowledgeRows).toEqual([]);

    const entryRows = await t.query(internal.internal.searchText.hydrateEntries, {
      userId: a.userId,
      ids: [bEntryId],
    });
    expect(entryRows).toEqual([]);
  });
});

describe('ai.search.hybridSearch', () => {
  it('scope "knowledge" returns only knowledge hits, scoped to the caller', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const b = await provisionedUser(t, USER_B);

    const aId = await a.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'defensive in code review',
    });
    await t.action(internal.ai.embed.run, { userId: a.userId, targetType: 'knowledge', targetId: aId });
    const bId = await b.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'defensive in code review',
    });
    await t.action(internal.ai.embed.run, { userId: b.userId, targetType: 'knowledge', targetId: bId });

    const results = await t.action(internal.ai.search.hybridSearch, {
      userId: a.userId,
      query: 'defensive in code review',
      limit: 10,
      scope: 'knowledge',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.objectType === 'knowledge')).toBe(true);
    expect(results.map((r) => r.id)).toContain(aId);
    expect(results.map((r) => r.id)).not.toContain(bId);
  });

  it('scope "entries" returns only entry hits', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const entryId = await a.as.mutation(api.entries.create, {
      kind: 'journal',
      body: 'a reflection on nervous interruptions',
      occurredAt: 1,
    });
    await t.action(internal.ai.embed.run, { userId: a.userId, targetType: 'entry', targetId: entryId });

    const results = await t.action(internal.ai.search.hybridSearch, {
      userId: a.userId,
      query: 'nervous interruptions',
      limit: 10,
      scope: 'entries',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.objectType === 'entry')).toBe(true);
    expect(results.map((r) => r.id)).toContain(entryId);
  });

  it('scope "both" can return a mix of knowledge and entry hits', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);

    const knowledgeId = await a.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'quarterly planning went well',
    });
    await t.action(internal.ai.embed.run, {
      userId: a.userId,
      targetType: 'knowledge',
      targetId: knowledgeId,
    });
    const entryId = await a.as.mutation(api.entries.create, {
      kind: 'journal',
      body: 'quarterly planning notes from today',
      occurredAt: 1,
    });
    await t.action(internal.ai.embed.run, { userId: a.userId, targetType: 'entry', targetId: entryId });

    const results = await t.action(internal.ai.search.hybridSearch, {
      userId: a.userId,
      query: 'quarterly planning',
      limit: 10,
      scope: 'both',
    });

    const kinds = new Set(results.map((r) => r.objectType));
    expect(kinds.has('knowledge')).toBe(true);
    expect(kinds.has('entry')).toBe(true);
  });

  it('a row with no embedding yet does not crash the search (missing-embedding fallback, 05 §5)', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);

    // Embedded row.
    const embeddedId = await a.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'has an embedding',
    });
    await t.action(internal.ai.embed.run, {
      userId: a.userId,
      targetType: 'knowledge',
      targetId: embeddedId,
    });
    // Never embedded (no ai.embed.run call for this one).
    await a.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'has no embedding',
    });

    const results = await t.action(internal.ai.search.hybridSearch, {
      userId: a.userId,
      query: 'embedding',
      limit: 10,
      scope: 'knowledge',
    });

    // The exact ranking doesn't matter here — the point is it returns at all,
    // via at least the full-text side, rather than throwing.
    expect(Array.isArray(results)).toBe(true);
  });
});
