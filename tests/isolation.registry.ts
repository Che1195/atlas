// ============================================================================
// Adversarial isolation registry (docs/spec/11-testing-strategy.md §2)
//
// EVERY public Convex function must have a row here describing how to invoke
// it as user B after user A has data. The registry-completeness test fails if
// a public function exists without a row — adding a function without deciding
// its isolation story is a build error, by design.
// ============================================================================

import type { TestConvex } from 'convex-test';
import type schema from '../convex/schema';

type T = TestConvex<typeof schema>;

export type IsolationCase = {
  /** "module.function" — must match an api export */
  fn: string;
  /**
   * Invoke the function as the given accessor identity (user B), in a world
   * where user A owns all data. Must either throw, or return nothing derived
   * from user A's rows (the assertion runs inside).
   */
  run: (t: T, accessor: { subject: string }) => Promise<void>;
};

export const ISOLATION_CASES: IsolationCase[] = [
  {
    fn: 'account.ensureUser',
    run: async (t, accessor) => {
      // B provisioning must not touch or return A's row.
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const idB = await asB.mutation((await apiOf()).account.ensureUser, {
        timezone: 'UTC',
      });
      const meB = await asB.query((await apiOf()).account.me, {});
      if (meB === null || meB.displayName !== 'User B') {
        throw new Error('ensureUser returned wrong subject data');
      }
      void idB;
    },
  },
  {
    fn: 'account.me',
    run: async (t, accessor) => {
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const meB = await asB.query((await apiOf()).account.me, {});
      // B is unprovisioned in this scenario variant: must be null, never A's profile.
      if (meB !== null && meB.displayName === 'User A') {
        throw new Error('me leaked another user profile');
      }
    },
  },
];

async function apiOf() {
  const { api } = await import('../convex/_generated/api');
  return api;
}
