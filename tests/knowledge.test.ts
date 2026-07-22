/// <reference types="vite/client" />
// Knowledge behavioral suite (AC-4.1 shape, AC-4.2 reason-required revisions, AC-4.3 archive).
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

describe('knowledge', () => {
  it('create defaults + first revision written', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'insight',
      statement: 'I become performative around perceived-higher-status people.',
    });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.confidence).toBe('hypothesis');
    expect(detail.origin).toBe('user');
    expect(detail.status).toBe('active');
    expect(detail.rev).toBe(1);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]).toMatchObject({ rev: 1, actor: 'user', reason: 'Created' });
    expect(detail.computation).toEqual({ suggested: 'hypothesis', supports: 0, contradicts: 0 });
  });

  it('create rejects over-length statements', async () => {
    const { asA } = await provisioned();
    await expect(
      asA.mutation(api.knowledge.create, { type: 'insight', statement: 'x'.repeat(281) }),
    ).rejects.toThrow();
  });

  it('revise requires a reason, bumps rev, snapshots (AC-4.2)', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, { type: 'insight', statement: 'v1' });
    await expect(
      asA.mutation(api.knowledge.revise, { id, patch: { statement: 'v2' }, reason: '  ' }),
    ).rejects.toThrow();
    await expect(
      asA.mutation(api.knowledge.revise, { id, patch: {}, reason: 'no-op' }),
    ).rejects.toThrow();
    await asA.mutation(api.knowledge.revise, { id, patch: { statement: 'v2' }, reason: 'sharper wording' });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.statement).toBe('v2');
    expect(detail.rev).toBe(2);
    expect(detail.revisions[0]).toMatchObject({ rev: 2, actor: 'user', reason: 'sharper wording' });
    expect(detail.revisions[0]?.snapshotStatement).toBe('v2');
  });

  it('archive removes from default list, keeps history (AC-4.3)', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, { type: 'principle', statement: 'p' });
    await asA.mutation(api.knowledge.archive, { id, reason: 'superseded by better wording' });
    expect(await asA.query(api.knowledge.list, {})).toEqual([]);
    const archived = await asA.query(api.knowledge.list, { status: 'archived' });
    expect(archived).toHaveLength(1);
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.status).toBe('archived');
    expect(detail.revisions).toHaveLength(2);
  });

  it('list filters by type and sorts by last revision', async () => {
    const { asA } = await provisioned();
    const a = await asA.mutation(api.knowledge.create, { type: 'insight', statement: 'first' });
    await asA.mutation(api.knowledge.create, { type: 'question', statement: 'second?' });
    await asA.mutation(api.knowledge.revise, { id: a, patch: { body: 'now touched' }, reason: 'add detail' });
    const all = await asA.query(api.knowledge.list, {});
    expect(all.map((k) => k.statement)).toEqual(['first', 'second?']); // revised most recently first
    const questions = await asA.query(api.knowledge.list, { type: 'question' });
    expect(questions.map((k) => k.statement)).toEqual(['second?']);
  });
});
