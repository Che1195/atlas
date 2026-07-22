/// <reference types="vite/client" />
// Guards against actor-default flips in convex/ops/knowledgeWrites.ts (Phase 3a Task 2):
// every public path that writes a revision must still stamp actor 'user' until the
// AI-approved path (a later task) explicitly passes { actor: 'ai-approved' }.
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

async function provisioned() {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity(USER_A);
  await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
  return { t, asA };
}

describe('knowledgeWrites actor stamping', () => {
  it('create writes a revision with actor "user"', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'insight',
      statement: 'Actor guard: create.',
    });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]?.actor).toBe('user');
  });

  it('revise writes a revision with actor "user"', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'insight',
      statement: 'Actor guard: revise v1.',
    });
    await asA.mutation(api.knowledge.revise, {
      id,
      patch: { statement: 'Actor guard: revise v2.' },
      reason: 'guard check',
    });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.revisions[0]?.actor).toBe('user');
    expect(detail.revisions[0]?.reason).toBe('guard check');
  });

  it('archive writes a revision with actor "user"', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'principle',
      statement: 'Actor guard: archive.',
    });
    await asA.mutation(api.knowledge.archive, { id, reason: 'guard check archive' });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.status).toBe('archived');
    expect(detail.revisions[0]?.actor).toBe('user');
  });

  it('evidence.add recompute-triggered revision has actor "user"', async () => {
    const { asA } = await provisioned();
    const knowledgeId = await asA.mutation(api.knowledge.create, {
      type: 'insight',
      statement: 'Actor guard: evidence add.',
    });
    const entryId = await asA.mutation(api.entries.create, {
      kind: 'journal',
      body: 'Evidence for the actor guard.',
      occurredAt: 1000,
    });
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(detail.confidence).toBe('tentative');
    expect(detail.revisions[0]?.actor).toBe('user');
  });

  it('evidence.remove recompute-triggered revision has actor "user"', async () => {
    const { asA } = await provisioned();
    const knowledgeId = await asA.mutation(api.knowledge.create, {
      type: 'insight',
      statement: 'Actor guard: evidence remove.',
    });
    const entryId = await asA.mutation(api.entries.create, {
      kind: 'journal',
      body: 'Evidence removed for the actor guard.',
      occurredAt: 1000,
    });
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    const evidenceId = detail.evidence[0]?._id;
    await asA.mutation(api.evidence.remove, { id: evidenceId! });
    const after = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(after.confidence).toBe('hypothesis');
    expect(after.revisions[0]?.actor).toBe('user');
  });
});
