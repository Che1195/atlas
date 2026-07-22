/// <reference types="vite/client" />
// Adversarial isolation suite (docs/spec/11-testing-strategy.md §2).
// Gate for every phase: user B can never see user A's data, for ANY public function.

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { ISOLATION_CASES } from './isolation.registry';

// convex-test needs the function modules; _generated is included for api resolution.
const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);

const USER_A = { subject: 'clerk_user_a', name: 'User A' };
const USER_B = { subject: 'clerk_user_b', name: 'User B' };

function freshWorld() {
  return convexTest(schema, modules);
}

describe('registry completeness', () => {
  it('every public function has an isolation case', async () => {
    // api is a proxy and can't be enumerated — walk the real modules instead.
    const publicFns: string[] = [];
    for (const [path, load] of Object.entries(modules)) {
      if (path.includes('/_generated/')) continue;
      const moduleName = path
        .replace('../convex/', '')
        .replace(/\.[jt]s$/, '')
        .replaceAll('/', '.');
      const moduleExports = (await load()) as Record<string, unknown>;
      for (const [fnName, exported] of Object.entries(moduleExports)) {
        // Registered Convex functions are callables tagged with isPublic (+ isQuery/isMutation/isAction).
        if (
          typeof exported === 'function' &&
          (exported as unknown as { isPublic?: boolean }).isPublic === true
        ) {
          publicFns.push(`${moduleName}.${fnName}`);
        }
      }
    }
    expect(publicFns.length).toBeGreaterThan(0);
    const covered = new Set(ISOLATION_CASES.map((isolationCase) => isolationCase.fn));
    const missing = publicFns.filter((fn) => !covered.has(fn));
    expect(missing, `Public functions missing isolation cases: ${missing.join(', ')}`).toEqual([]);
    // And no stale rows for functions that no longer exist:
    const stale = [...covered].filter((fn) => !publicFns.includes(fn));
    expect(stale, `Registry rows for nonexistent functions: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('adversarial isolation', () => {
  for (const isolationCase of ISOLATION_CASES) {
    it(`${isolationCase.fn}: user B cannot reach user A's data`, async () => {
      const t = freshWorld();
      // Seed: user A exists with a provisioned account.
      await t
        .withIdentity(USER_A)
        .mutation(api.account.ensureUser, { timezone: 'America/New_York' });
      await isolationCase.run(t, USER_B);
    });
  }
});

describe('account provisioning behavior', () => {
  it('ensureUser is idempotent and me returns own profile only', async () => {
    const t = freshWorld();
    const asA = t.withIdentity(USER_A);
    const first = await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
    const second = await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
    expect(first).toEqual(second);

    const me = await asA.query(api.account.me, {});
    expect(me?.displayName).toBe('User A');
    expect(me?.settings.autoDistill).toBe(false);
  });

  it('rejects unauthenticated calls and invalid timezones', async () => {
    const t = freshWorld();
    await expect(t.mutation(api.account.ensureUser, { timezone: 'UTC' })).rejects.toThrow();
    await expect(
      t.withIdentity(USER_A).mutation(api.account.ensureUser, { timezone: 'Not/AZone' }),
    ).rejects.toThrow();
  });

  it('me returns null before provisioning (never someone else)', async () => {
    const t = freshWorld();
    await t.withIdentity(USER_A).mutation(api.account.ensureUser, { timezone: 'UTC' });
    const meB = await t.withIdentity(USER_B).query(api.account.me, {});
    expect(meB).toBeNull();
  });

  // Regression: Clerk's Convex integration token omits the `name` claim in prod
  // (2026-07-21). The displayName arg is the designed fallback — it must work.
  it('falls back to the displayName arg when the identity has no name claim', async () => {
    const t = freshWorld();
    const asNameless = t.withIdentity({ subject: 'clerk_user_nameless' });
    await asNameless.mutation(api.account.ensureUser, {
      timezone: 'UTC',
      displayName: 'Abeche Ndumbi',
    });
    const me = await asNameless.query(api.account.me, {});
    expect(me?.displayName).toBe('Abeche Ndumbi');
  });

  it('rejects provisioning when neither name claim nor displayName arg exists', async () => {
    const t = freshWorld();
    await expect(
      t.withIdentity({ subject: 'clerk_user_nameless' }).mutation(api.account.ensureUser, {
        timezone: 'UTC',
      }),
    ).rejects.toThrow();
  });

  // Regression: Clerk's Convex integration token also omits the `email` claim
  // (found by the E2E harness, 2026-07-22). The email arg is the designed
  // fallback — same shape as the displayName gap above.
  it('falls back to the email arg when the identity has no email claim', async () => {
    const t = freshWorld();
    const asEmailless = t.withIdentity({ subject: 'clerk_user_emailless', name: 'No Email' });
    await asEmailless.mutation(api.account.ensureUser, {
      timezone: 'UTC',
      email: 'noemail+clerk_test@example.com',
    });
    const me = await asEmailless.query(api.account.me, {});
    expect(me?.email).toBe('noemail+clerk_test@example.com');
  });

  it('re-syncs an already-broken empty email once the arg is supplied', async () => {
    const t = freshWorld();
    const asEmailless = t.withIdentity({ subject: 'clerk_user_emailless2', name: 'No Email' });
    // First call: no email claim, no email arg — row provisioned with ''.
    await asEmailless.mutation(api.account.ensureUser, { timezone: 'UTC' });
    const before = await asEmailless.query(api.account.me, {});
    expect(before?.email).toBe('');

    // Second call: email arg supplied — existing row should re-sync.
    await asEmailless.mutation(api.account.ensureUser, {
      timezone: 'UTC',
      email: 'healed+clerk_test@example.com',
    });
    const after = await asEmailless.query(api.account.me, {});
    expect(after?.email).toBe('healed+clerk_test@example.com');
  });
});
