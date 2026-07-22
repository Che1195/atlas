// E2E pre-clean (docs/spec/11-testing-strategy.md §3: "pre-clean is idempotent by
// test-user id"). INTERNAL by design — never export a public wrapper; the guard
// below is the only thing standing between a bad test config and real data.
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

const OWNED_TABLES = [
  'entries',
  'knowledge',
  'evidence',
  'relationships',
  'experiments',
  'outcomes',
  'revisions',
  'proposals',
  'reviews',
  'apiKeys',
  'aiRuns',
  'issues',
] as const;

export const clearTestUser = internalMutation({
  args: { clerkId: v.string(), allowEmptyEmail: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .unique();
    if (user === null) return { deleted: false as const, reason: 'no such user' };
    const isTestAccount = user.email.includes('+clerk_test');
    // allowEmptyEmail is a bounded escape hatch for rows broken by the (now
    // fixed) missing-email-claim bug: internal-only, the caller resolves
    // clerkIds from +clerk_test Clerk accounts via the Clerk API, and post-fix
    // no new rows have empty emails — so this only ever reaches legacy broken
    // rows for the explicitly-addressed clerkId. It never widens the guard
    // to arbitrary non-test accounts (see the real-email refusal below).
    const isAllowedEmptyEmail = user.email === '' && args.allowEmptyEmail === true;
    if (!isTestAccount && !isAllowedEmptyEmail) {
      return { deleted: false as const, reason: 'refusing: not a +clerk_test account' };
    }

    let rows = 0;
    for (const table of OWNED_TABLES) {
      // Every owned table's first index leads with userId (schema invariant), but index
      // names differ — a full scan filtered by userId is fine at test-data scale and
      // keeps this maintenance-free as tables evolve.
      const docs = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field('userId'), user._id))
        .collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
        rows += 1;
      }
    }
    // crashes.userId is optional — clear the test user's crash rows too.
    const crashes = await ctx.db
      .query('crashes')
      .filter((q) => q.eq(q.field('userId'), user._id))
      .collect();
    for (const crash of crashes) {
      await ctx.db.delete(crash._id);
      rows += 1;
    }
    await ctx.db.delete(user._id);
    return { deleted: true as const, rows };
  },
});
