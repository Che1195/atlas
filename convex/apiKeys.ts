// API keys backend (Phase M Task 5, docs/spec/06-mcp-interface.md §1, 08 §3).
// Public surface: create/list/revoke. `create` is deliberately an ACTION, not a
// mutation — see the comment on `create` below for why.
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { action, mutation, query } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { randomHex } from './lib/randomHex';
import { sha256Hex, type Scope } from './mcp/auth';

const scopeValidator = v.union(v.literal('read'), v.literal('capture'), v.literal('propose'));

/**
 * CRYPTO/DESIGN CHOICE: `create` is a public ACTION rather than a mutation.
 * Hashing the freshly generated plaintext key requires `crypto.subtle.digest`
 * (Web Crypto, async) — the same primitive `convex/mcp/auth.ts`'s `sha256Hex`
 * already relies on inside httpActions. Query/mutation contexts run in
 * Convex's deterministic, transactional isolate, and whether `crypto.subtle`
 * is available there is unverified (no existing code in this codebase calls
 * it from a mutation); actions are unambiguously safe, since httpActions
 * (which ARE actions) already do this exact digest today. Rather than risk a
 * mutation-only failure mode that only surfaces against a real deployment,
 * `create` runs as an action: it resolves the caller's identity itself
 * (ActionCtx.auth works the same as QueryCtx/MutationCtx.auth — same
 * propagated identity), looks up the user id via an internal query, generates
 * + hashes the key, and inserts through an internal mutation — preserving the
 * "internal functions take userId as an explicit first param" convention
 * (08 §2) even though the action, not `requireUser`, did the resolution.
 * `list`/`revoke` do no hashing, so they stay plain query/mutation.
 */
export const create = action({
  args: { name: v.string(), scopes: v.array(scopeValidator) },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: string; name: string; prefix: string; scopes: Scope[]; plaintext: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({ code: 'unauthenticated', message: 'Sign in required.' });
    }
    const name = args.name.trim();
    if (name.length === 0) {
      throw new ConvexError({ code: 'invalid_input', message: 'name must not be empty.' });
    }
    if (args.scopes.length === 0) {
      throw new ConvexError({ code: 'invalid_input', message: 'At least one scope is required.' });
    }

    const userId = await ctx.runQuery(internal.internal.identity.resolveUserId, {
      clerkId: identity.subject,
    });
    if (userId === null) {
      throw new ConvexError({
        code: 'no_user',
        message: 'Account not provisioned — call account.ensureUser first.',
      });
    }

    const plaintext = `atlas_sk_${randomHex(20)}`;
    const keyHash = await sha256Hex(plaintext);
    const prefix = plaintext.slice(0, 12);

    const id = await ctx.runMutation(internal.internal.apiKeyStore.insert, {
      userId,
      name,
      keyHash,
      prefix,
      scopes: args.scopes,
    });

    return { id, name, prefix, scopes: args.scopes, plaintext };
  },
});

/** Name, prefix, scopes, lastUsedAt, createdAt, revoked flag — never the hash. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('apiKeys')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    return rows
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((row) => ({
        _id: row._id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        lastUsedAt: row.lastUsedAt,
        createdAt: row._creationTime,
        revoked: row.revokedAt !== undefined,
      }));
  },
});

export const revoke = mutation({
  args: { id: v.id('apiKeys') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const key = assertOwner(await ctx.db.get(args.id), user);
    if (key.revokedAt === undefined) {
      await ctx.db.patch(key._id, { revokedAt: Date.now() });
    }
    return null;
  },
});
