// ============================================================================
// SUBJECT-SCOPING INVARIANT (docs/spec/08-security-model.md §2)
//
// Every public Convex function derives the acting user from ctx.auth via
// requireUser() below — the ONLY auth entry point. No public function may
// accept a userId argument from the client. Every query goes through an index
// leading with userId; every db.get is followed by an ownership assertion
// (doc.userId === user._id) before its contents are read or written.
//
// Internal functions take the subject's userId as their FIRST parameter so the
// subject is explicit and visible at every call site — never assumed.
//
// Enforced by: this helper, scripts/check-invariants.sh (lint step), and the
// adversarial isolation suite (tests/isolation.test.ts).
// ============================================================================

import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/** Resolve the authenticated user's row, or throw. The only auth entry point. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'>> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: 'unauthenticated', message: 'Sign in required.' });
  }
  const user = await ctx.db
    .query('users')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
    .unique();
  if (user === null) {
    throw new ConvexError({
      code: 'no_user',
      message: 'Account not provisioned — call account.ensureUser first.',
    });
  }
  return user;
}

/** Like requireUser, but returns null when signed out or unprovisioned (for optional-auth queries). */
export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return null;
  return await ctx.db
    .query('users')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
    .unique();
}

/** Ownership assertion for documents fetched by id. Call after EVERY db.get. */
export function assertOwner<T extends { userId: Doc<'users'>['_id'] }>(
  doc: T | null,
  user: Doc<'users'>,
): T {
  if (doc === null || doc.userId !== user._id) {
    // Same error for "missing" and "not yours" — never confirm another user's ids exist.
    throw new ConvexError({ code: 'not_found', message: 'Not found.' });
  }
  return doc;
}
