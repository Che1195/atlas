// Public surface for the consent flow (Phase M Task 5, docs/spec/06 §1):
// `getClient` (read-only, lets the consent UI show the client's registered
// name + redirect_uris before rendering anything) and `approveGrant` (issues
// the authorization code once the user approves).
import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import { action, mutation, query } from '../_generated/server';
import { assertOwner, requireUser } from '../lib/auth';
import { randomHex } from '../lib/randomHex';
import { sha256Hex } from '../mcp/auth';
import { CODE_TTL_MS } from './token';

const scopeValidator = v.union(v.literal('read'), v.literal('capture'), v.literal('propose'));

/**
 * Read-only lookup of a registered client's public metadata by its client_id.
 * Requires auth (this lives behind the Clerk-authed (app) layout) but performs
 * no ownership check — oauthClients rows aren't user-owned; any registered
 * client's name/redirect_uris are meant to be shown to whichever user is about
 * to consent, same as any OAuth AS's consent screen.
 */
export const getClient = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const client = await ctx.db
      .query('oauthClients')
      .withIndex('by_clientId', (q) => q.eq('clientId', args.clientId))
      .unique();
    if (client === null) return null;
    return { name: client.name, redirectUris: client.redirectUris };
  },
});

/**
 * CRYPTO/DESIGN CHOICE: an ACTION, same reasoning as apiKeys.ts's `create` —
 * issuing a code means hashing it (crypto.subtle.digest), which this codebase
 * only relies on inside actions/httpActions today. Identity is resolved the
 * same way `create` does (ActionCtx.auth -> internal.internal.identity.resolveUserId).
 */
export const approveGrant = action({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    scopes: v.array(scopeValidator),
    codeChallenge: v.string(),
  },
  handler: async (ctx, args): Promise<{ code: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({ code: 'unauthenticated', message: 'Sign in required.' });
    }
    if (args.scopes.length === 0) {
      throw new ConvexError({ code: 'invalid_input', message: 'At least one scope is required.' });
    }
    if (args.codeChallenge.trim().length === 0) {
      throw new ConvexError({ code: 'invalid_input', message: 'codeChallenge is required (PKCE S256).' });
    }

    const client = await ctx.runQuery(internal.internal.oauthStore.findClientById, {
      clientId: args.clientId,
    });
    if (client === null) {
      throw new ConvexError({ code: 'invalid_client', message: 'Unknown OAuth client.' });
    }
    if (!client.redirectUris.includes(args.redirectUri)) {
      throw new ConvexError({
        code: 'invalid_redirect_uri',
        message: "redirect_uri is not registered for this client.",
      });
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

    // Authorization code (RFC 6749) — distinct prefix from bearer/access/refresh
    // tokens so a leaked log line is self-describing; hashed at rest same as
    // every other Atlas-minted secret (08 §3).
    const code = `atlas_oac_${randomHex(20)}`;
    const codeHash = await sha256Hex(code);

    await ctx.runMutation(internal.internal.oauthStore.insertGrantCode, {
      userId,
      clientId: args.clientId,
      scopes: args.scopes,
      codeHash,
      codeExpiresAt: Date.now() + CODE_TTL_MS,
      codeChallenge: args.codeChallenge,
      redirectUri: args.redirectUri,
    });

    return { code };
  },
});

/**
 * List the caller's OAuth grants for the Connections screen (Phase M Task 6,
 * docs/spec/06-mcp-interface.md §4). Includes rows still mid-flow (consent
 * approved, code not yet exchanged) as well as established grants — same
 * "show everything the user owns" stance as apiKeys.list. Never returns
 * codeHash/accessTokenHash/refreshTokenHash.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('oauthGrants')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    const sorted = rows.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      sorted.map(async (row) => {
        const client = await ctx.db
          .query('oauthClients')
          .withIndex('by_clientId', (q) => q.eq('clientId', row.clientId))
          .unique();
        return {
          _id: row._id,
          clientName: client?.name ?? row.clientId,
          scopes: row.scopes,
          grantedAt: row._creationTime,
          revoked: row.revokedAt !== undefined,
        };
      }),
    );
  },
});

/** Revoke one of the caller's own OAuth grants — assertOwner-equivalent (grant.userId check). */
export const revokeMine = mutation({
  args: { id: v.id('oauthGrants') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const grant = assertOwner(await ctx.db.get(args.id), user);
    if (grant.revokedAt === undefined) {
      await ctx.db.patch(grant._id, { revokedAt: Date.now() });
    }
    return null;
  },
});
