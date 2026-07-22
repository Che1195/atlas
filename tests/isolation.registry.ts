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

const USER_A = { subject: 'clerk_user_a', name: 'User A' };

/** Seed an entry owned by user A; returns its id. A is already provisioned by the suite. */
async function seedEntryForA(t: T): Promise<string> {
  const api = await apiOf();
  return await t
    .withIdentity(USER_A)
    .mutation(api.entries.create, { kind: 'journal', body: 'A private entry', occurredAt: 1000 });
}

/** Seed a knowledge object owned by user A; returns its id. */
async function seedKnowledgeForA(t: T): Promise<string> {
  const api = await apiOf();
  return await t
    .withIdentity(USER_A)
    .mutation(api.knowledge.create, { type: 'insight', statement: 'A private insight' });
}

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
  {
    fn: 'entries.create',
    run: async (t, accessor) => {
      await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      await asB.mutation(api.entries.create, { kind: 'note', body: 'B entry', occurredAt: 1 });
      const listB = await asB.query(api.entries.list, {});
      if (listB.length !== 1 || listB[0]?.excerpt !== 'B entry') {
        throw new Error('entries.create/list leaked another user’s entries');
      }
    },
  },
  {
    fn: 'entries.list',
    run: async (t, accessor) => {
      await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      const listB = await asB.query(api.entries.list, {});
      if (listB.length !== 0) throw new Error('entries.list leaked another user’s entries');
    },
  },
  {
    fn: 'entries.get',
    run: async (t, accessor) => {
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.query(api.entries.get, { id: entryIdA as never });
        leaked = true;
      } catch {
        // expected: uniform not_found
      }
      if (leaked) throw new Error('entries.get returned another user’s entry');
    },
  },
  {
    fn: 'entries.update',
    run: async (t, accessor) => {
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.entries.update, { id: entryIdA as never, body: 'defaced' });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('entries.update mutated another user’s entry');
    },
  },
  {
    fn: 'entries.remove',
    run: async (t, accessor) => {
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.entries.remove, { id: entryIdA as never });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('entries.remove deleted another user’s entry');
    },
  },
  {
    fn: 'knowledge.create',
    run: async (t, accessor) => {
      await seedKnowledgeForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      await asB.mutation(api.knowledge.create, { type: 'insight', statement: 'B insight' });
      const listB = await asB.query(api.knowledge.list, {});
      if (listB.length !== 1 || listB[0]?.statement !== 'B insight') {
        throw new Error('knowledge.create/list leaked another user’s objects');
      }
    },
  },
  {
    fn: 'knowledge.list',
    run: async (t, accessor) => {
      await seedKnowledgeForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      const listB = await asB.query(api.knowledge.list, {});
      if (listB.length !== 0) throw new Error('knowledge.list leaked another user’s objects');
    },
  },
  {
    fn: 'knowledge.get',
    run: async (t, accessor) => {
      const knowledgeIdA = await seedKnowledgeForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.query(api.knowledge.get, { id: knowledgeIdA as never });
        leaked = true;
      } catch {
        // expected: uniform not_found
      }
      if (leaked) throw new Error('knowledge.get returned another user’s object');
    },
  },
  {
    fn: 'knowledge.revise',
    run: async (t, accessor) => {
      const knowledgeIdA = await seedKnowledgeForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.knowledge.revise, {
          id: knowledgeIdA as never,
          patch: { statement: 'defaced' },
          reason: 'attack',
        });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('knowledge.revise mutated another user’s object');
    },
  },
  {
    fn: 'knowledge.archive',
    run: async (t, accessor) => {
      const knowledgeIdA = await seedKnowledgeForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.knowledge.archive, { id: knowledgeIdA as never, reason: 'attack' });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('knowledge.archive mutated another user’s object');
    },
  },
  {
    fn: 'evidence.add',
    run: async (t, accessor) => {
      const knowledgeIdA = await seedKnowledgeForA(t);
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.evidence.add, {
          knowledgeId: knowledgeIdA as never,
          entryId: entryIdA as never,
          stance: 'supports',
        });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('evidence.add linked another user’s objects');

      // Half-owned case: B's own entry cited against A's knowledgeId must still throw
      // (the knowledge assertOwner fires first).
      const entryIdB = await asB.mutation(api.entries.create, {
        kind: 'note',
        body: 'B entry',
        occurredAt: 1,
      });
      let leakedHalfOwned = false;
      try {
        await asB.mutation(api.evidence.add, {
          knowledgeId: knowledgeIdA as never,
          entryId: entryIdB,
          stance: 'supports',
        });
        leakedHalfOwned = true;
      } catch {
        // expected
      }
      if (leakedHalfOwned) {
        throw new Error('evidence.add linked B’s entry to A’s knowledge object');
      }
    },
  },
  {
    fn: 'evidence.remove',
    run: async (t, accessor) => {
      const api = await apiOf();
      const knowledgeIdA = await seedKnowledgeForA(t);
      const entryIdA = await seedEntryForA(t);
      const asA = t.withIdentity(USER_A);
      await asA.mutation(api.evidence.add, {
        knowledgeId: knowledgeIdA as never,
        entryId: entryIdA as never,
        stance: 'supports',
      });
      const detail = await asA.query(api.knowledge.get, { id: knowledgeIdA as never });
      const evidenceIdA = detail.evidence[0]?._id;

      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.evidence.remove, { id: evidenceIdA as never });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('evidence.remove deleted another user’s evidence row');
    },
  },
];

async function apiOf() {
  const { api } = await import('../convex/_generated/api');
  return api;
}
