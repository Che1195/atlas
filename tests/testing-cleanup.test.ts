/// <reference types="vite/client" />
// Guarded test-data cleanup (Phase 2 E2E pre-clean). The guard is the point:
// this must be structurally unable to wipe a real account.
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);

const TEST_USER = {
  subject: 'clerk_e2e_a',
  name: 'E2E User',
  email: 'atlas.e2e+clerk_test@example.com',
};
const REAL_USER = { subject: 'clerk_real', name: 'Real Person', email: 'abeche88@gmail.com' };

async function seededWorld(identity: typeof TEST_USER) {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity(identity);
  await asUser.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const entryId = await asUser.mutation(api.entries.create, {
    kind: 'journal',
    body: 'seed',
    occurredAt: 1000,
  });
  const knowledgeId = await asUser.mutation(api.knowledge.create, {
    type: 'insight',
    statement: 'seed insight',
  });
  await asUser.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
  return { t, asUser };
}

describe('internal/testing.clearTestUser', () => {
  it('deletes every row for a +clerk_test user', async () => {
    const { t, asUser } = await seededWorld(TEST_USER);
    const result = await t.mutation(internal.internal.testing.clearTestUser, {
      clerkId: TEST_USER.subject,
    });
    expect(result.deleted).toBe(true);
    expect(await asUser.query(api.account.me, {})).toBeNull();
    // Re-provision proves entries/knowledge are gone, not just the users row.
    await asUser.mutation(api.account.ensureUser, { timezone: 'UTC' });
    expect(await asUser.query(api.entries.list, {})).toEqual([]);
    expect(await asUser.query(api.knowledge.list, {})).toEqual([]);
  });

  it('refuses to touch an account without +clerk_test in the email', async () => {
    const world = convexTest(schema, modules);
    const asReal = world.withIdentity(REAL_USER);
    await asReal.mutation(api.account.ensureUser, { timezone: 'UTC' });
    const result = await world.mutation(internal.internal.testing.clearTestUser, {
      clerkId: REAL_USER.subject,
    });
    expect(result.deleted).toBe(false);
    expect(await asReal.query(api.account.me, {})).not.toBeNull();
  });

  it('is a no-op for unknown clerkIds', async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(internal.internal.testing.clearTestUser, {
      clerkId: 'clerk_nobody',
    });
    expect(result.deleted).toBe(false);
  });

  // Regression: Clerk's Convex integration token omits the `email` claim, so
  // legacy rows were provisioned with email === ''. allowEmptyEmail is a
  // bounded escape hatch for those already-broken rows only.
  it('refuses an empty-email account without allowEmptyEmail', async () => {
    const t = convexTest(schema, modules);
    const emptyEmailUser = { subject: 'clerk_emptyemail', name: 'No Email' };
    await t.withIdentity(emptyEmailUser).mutation(api.account.ensureUser, { timezone: 'UTC' });
    const result = await t.mutation(internal.internal.testing.clearTestUser, {
      clerkId: emptyEmailUser.subject,
    });
    expect(result.deleted).toBe(false);
  });

  it('deletes an empty-email account when allowEmptyEmail is true', async () => {
    const t = convexTest(schema, modules);
    const emptyEmailUser = { subject: 'clerk_emptyemail2', name: 'No Email' };
    const asUser = t.withIdentity(emptyEmailUser);
    await asUser.mutation(api.account.ensureUser, { timezone: 'UTC' });
    const result = await t.mutation(internal.internal.testing.clearTestUser, {
      clerkId: emptyEmailUser.subject,
      allowEmptyEmail: true,
    });
    expect(result.deleted).toBe(true);
    expect(await asUser.query(api.account.me, {})).toBeNull();
  });

  it('refuses a real-email account even with allowEmptyEmail: true', async () => {
    const world = convexTest(schema, modules);
    const asReal = world.withIdentity(REAL_USER);
    await asReal.mutation(api.account.ensureUser, { timezone: 'UTC' });
    const result = await world.mutation(internal.internal.testing.clearTestUser, {
      clerkId: REAL_USER.subject,
      allowEmptyEmail: true,
    });
    expect(result.deleted).toBe(false);
    expect(await asReal.query(api.account.me, {})).not.toBeNull();
  });
});
