/// <reference types="vite/client" />
// Entries behavioral suite (AC-2.1, AC-2.4 archive half lands with evidence in Task 4).
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

describe('entries', () => {
  it('create + list roundtrip with source app and newest-first order (AC-2.1)', async () => {
    const { asA } = await provisioned();
    await asA.mutation(api.entries.create, { kind: 'journal', body: 'older', occurredAt: 1000 });
    await asA.mutation(api.entries.create, { kind: 'note', body: 'newer', occurredAt: 2000 });
    const list = await asA.query(api.entries.list, {});
    expect(list.map((e) => e.excerpt)).toEqual(['newer', 'older']);
    expect(list[0]?.source).toBe('app');
    expect(list[0]?.kind).toBe('note');
  });

  it('create rejects empty body', async () => {
    const { asA } = await provisioned();
    await expect(
      asA.mutation(api.entries.create, { kind: 'journal', body: '   ', occurredAt: 1000 }),
    ).rejects.toThrow();
  });

  it('update patches fields and stamps editedAt', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.entries.create, { kind: 'journal', body: 'v1', occurredAt: 1000 });
    await asA.mutation(api.entries.update, { id, body: 'v2', title: 'T' });
    const entry = await asA.query(api.entries.get, { id });
    expect(entry.body).toBe('v2');
    expect(entry.title).toBe('T');
    expect(entry.editedAt).toBeTypeOf('number');
  });

  it('remove deletes an uncited entry outright', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.entries.create, { kind: 'journal', body: 'x', occurredAt: 1 });
    const result = await asA.mutation(api.entries.remove, { id });
    expect(result).toEqual({ deleted: true });
    expect(await asA.query(api.entries.list, {})).toEqual([]);
  });

  it('get returns citedBy empty when no evidence exists', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.entries.create, { kind: 'journal', body: 'x', occurredAt: 1 });
    const entry = await asA.query(api.entries.get, { id });
    expect(entry.citedBy).toEqual([]);
  });
});
