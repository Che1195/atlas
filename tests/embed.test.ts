/// <reference types="vite/client" />
// TDD for the embed action + scheduling triggers (Phase M Task 3,
// docs/spec/05-ai-pipeline.md §1 "embed"): entry create/edit and knowledge
// create/statement-change schedule internal.ai.embed.run; the action stamps
// embedding + embeddingVersion; missing OPENAI_API_KEY on the live path is an
// honest 'no_provider' error (mirrors distill's Phase M Task 2 discipline).
//
// Fake timers throughout: entries.create/knowledge.create always schedule a
// real ctx.scheduler.runAfter(0, ...) embed job. Without fake timers that job
// is a genuine pending real-time setTimeout that could fire at an unpredictable
// point relative to a test's later direct `t.action(internal.ai.embed.run, ...)`
// call (both share the same idempotent runId, so a race isn't unsafe, but it
// is nondeterministic). Fake timers make "did the auto-scheduled job run" an
// explicit choice (`finishAllScheduledFunctions`) rather than a race.
process.env.AI_PROVIDER = 'stub';

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import { EMBED_DIMENSIONS, EMBED_MODEL, EMBED_VERSION } from '../convex/ai/models';
import { embedStub } from '../convex/lib/embedStub';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

type World = TestConvex<typeof schema>;
type AsUser = ReturnType<World['withIdentity']>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

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

async function aiRunFor(t: World, runId: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('aiRuns')
      .withIndex('by_runId', (q) => q.eq('runId', runId))
      .unique(),
  );
}

describe('entries.create / update schedule internal.ai.embed.run', () => {
  it('create schedules an embed that lands on the row once the scheduler flushes', async () => {
    const { t, asA } = await provisioned();
    const entryId = await createEntry(asA, 'I noticed I get defensive in code review.');
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const doc = await t.run(async (ctx) => ctx.db.get(entryId));
    expect(doc?.embedding).toHaveLength(EMBED_DIMENSIONS);
    expect(doc?.embeddingVersion).toBe(EMBED_VERSION);
    expect(doc?.embedding).toEqual(
      embedStub('I noticed I get defensive in code review.', EMBED_DIMENSIONS),
    );
  });

  it('update with a body change re-embeds with the new text (direct action call)', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'original body');
    await t.action(internal.ai.embed.run, { userId, targetType: 'entry', targetId: entryId });

    await asA.mutation(api.entries.update, { id: entryId, body: 'updated body' });
    await t.action(internal.ai.embed.run, { userId, targetType: 'entry', targetId: entryId });

    const doc = await t.run(async (ctx) => ctx.db.get(entryId));
    expect(doc?.embedding).toEqual(embedStub('updated body', EMBED_DIMENSIONS));
    expect(doc?.embeddingVersion).toBe(EMBED_VERSION);
  });

  it('update with only a title change never lets the row drift from its last embed', async () => {
    const { t, asA } = await provisioned();
    const entryId = await createEntry(asA, 'body text');
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await asA.mutation(api.entries.update, { id: entryId, title: 'new title only' });
    // No second schedule should exist to flush, but flushing is harmless/idempotent
    // if the guard ever regressed — this proves the embedding stays exactly what
    // create produced, not merely that "nothing happened to error out".
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const doc = await t.run(async (ctx) => ctx.db.get(entryId));
    expect(doc?.embedding).toEqual(embedStub('body text', EMBED_DIMENSIONS));
  });
});

describe('knowledge create / statement-change schedule internal.ai.embed.run', () => {
  it('knowledge.create embeds statement (+ body when present)', async () => {
    const { t, asA, userId } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'I get defensive in code review.',
      body: 'Extra context.',
    });
    await t.action(internal.ai.embed.run, { userId, targetType: 'knowledge', targetId: id });

    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc?.embedding).toEqual(
      embedStub('I get defensive in code review.\n\nExtra context.', EMBED_DIMENSIONS),
    );
    expect(doc?.embeddingVersion).toBe(EMBED_VERSION);
  });

  it('revise changing the statement re-embeds with the new text', async () => {
    const { t, asA, userId } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'Original statement.',
    });
    await t.action(internal.ai.embed.run, { userId, targetType: 'knowledge', targetId: id });

    await asA.mutation(api.knowledge.revise, {
      id,
      patch: { statement: 'Revised statement.' },
      reason: 'test revision',
    });
    await t.action(internal.ai.embed.run, { userId, targetType: 'knowledge', targetId: id });

    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc?.embedding).toEqual(embedStub('Revised statement.', EMBED_DIMENSIONS));
  });

  it('revise changing only the type does not re-embed (statement/body-only gate)', async () => {
    const { t, asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'Type-only patch guard.',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterCreate = await t.run(async (ctx) => ctx.db.get(id));
    expect(afterCreate?.embedding).toEqual(embedStub('Type-only patch guard.', EMBED_DIMENSIONS));

    await asA.mutation(api.knowledge.revise, {
      id,
      patch: { type: 'insight' },
      reason: 'type-only change',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc?.embedding).toEqual(embedStub('Type-only patch guard.', EMBED_DIMENSIONS));
    expect(doc?.type).toBe('insight');
  });
});

describe('ai.embed.run (stub provider)', () => {
  it('stamps embedding + embeddingVersion and finishes the aiRun ok', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'entry body for direct embed call');

    await t.action(internal.ai.embed.run, { userId, targetType: 'entry', targetId: entryId });

    const doc = await t.run(async (ctx) => ctx.db.get(entryId));
    expect(doc?.embedding).toHaveLength(EMBED_DIMENSIONS);
    expect(doc?.embeddingVersion).toBe(EMBED_VERSION);

    const runRow = await aiRunFor(t, `embed:entry:${entryId}`);
    expect(runRow?.status).toBe('ok');
    expect(runRow?.model).toBe(EMBED_MODEL);
  });

  it('a deleted target between schedule and run finishes ok with no write (fire-and-forget legality)', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'will be deleted');
    await asA.mutation(api.entries.remove, { id: entryId });

    await t.action(internal.ai.embed.run, { userId, targetType: 'entry', targetId: entryId });

    const runRow = await aiRunFor(t, `embed:entry:${entryId}`);
    expect(runRow?.status).toBe('ok');
  });
});

describe('ai.embed.run (live path, no OPENAI_API_KEY configured)', () => {
  it('finishes error "no_provider" with no embedding written and no provider call', async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const createMock = vi.fn();
    vi.doMock('openai', () => ({
      default: class MockOpenAI {
        embeddings = { create: createMock };
      },
    }));

    try {
      const { t, asA, userId } = await provisioned();
      const entryId = await createEntry(asA, 'no key configured');

      await t.action(internal.ai.embed.run, { userId, targetType: 'entry', targetId: entryId });

      expect(createMock).not.toHaveBeenCalled();
      const doc = await t.run(async (ctx) => ctx.db.get(entryId));
      expect(doc?.embedding).toBeUndefined();

      const runRow = await aiRunFor(t, `embed:entry:${entryId}`);
      expect(runRow?.status).toBe('error');
      expect(runRow?.error).toBe('no_provider');
    } finally {
      process.env.AI_PROVIDER = 'stub';
      vi.doUnmock('openai');
    }
  });
});
