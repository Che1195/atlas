// OAuth 2.1 + DCR authorization-server storage (Phase M Task 5, docs/spec/06 §1,
// ADR-0012). Internal only — httpAction contexts (convex/oauth/*.ts) and the
// consent-approval action (convex/oauth/grants.ts) have no ctx.db, so every
// oauthClients/oauthGrants read or write goes through these functions. Explicit
// userId is the first param wherever a subject is known (08 §2); client lookups
// and code/token hash lookups take no subject — same as apiKeys.findByHash,
// they resolve the subject rather than assuming it.
import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { checkRateLimit, type RateLimitResult } from '../lib/rateLimit';

const scopeValidator = v.union(v.literal('read'), v.literal('capture'), v.literal('propose'));

// Identity resolution lives in convex/internal/identity.ts (shared with
// apiKeys.ts's action-based `create` — both need to resolve a Clerk subject to
// a userId from an ActionCtx, which has no ctx.db of its own).

// --- Clients (RFC 7591 DCR) ---

export const findClientById = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('oauthClients')
      .withIndex('by_clientId', (q) => q.eq('clientId', args.clientId))
      .unique();
  },
});

export const insertClient = internalMutation({
  args: { clientId: v.string(), name: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.insert('oauthClients', {
      clientId: args.clientId,
      name: args.name,
      redirectUris: args.redirectUris,
      tokenEndpointAuthMethod: 'none',
    });
  },
});

// --- Grants: consent -> code -> token exchange -> refresh rotation ---

/** Consent approved: one new grant row per authorization, code fields set, no tokens yet. */
export const insertGrantCode = internalMutation({
  args: {
    userId: v.id('users'),
    clientId: v.string(),
    scopes: v.array(scopeValidator),
    codeHash: v.string(),
    codeExpiresAt: v.number(),
    codeChallenge: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('oauthGrants', {
      userId: args.userId,
      clientId: args.clientId,
      scopes: args.scopes,
      codeHash: args.codeHash,
      codeExpiresAt: args.codeExpiresAt,
      codeChallenge: args.codeChallenge,
      redirectUri: args.redirectUri,
    });
  },
});

export const findGrantByCodeHash = internalQuery({
  args: { codeHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('oauthGrants')
      .withIndex('by_codeHash', (q) => q.eq('codeHash', args.codeHash))
      .unique();
  },
});

/** Single-use enforcement: clear the code fields regardless of outcome (called on
 * expiry and PKCE mismatch too, not just success — a failed attempt burns the code
 * rather than allowing a verifier-guessing retry loop). */
export const consumeCode = internalMutation({
  args: { grantId: v.id('oauthGrants') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.grantId, {
      codeHash: undefined,
      codeExpiresAt: undefined,
      codeChallenge: undefined,
    });
  },
});

/** Successful code exchange: consume the code AND issue the first token pair, atomically. */
export const exchangeCode = internalMutation({
  args: { grantId: v.id('oauthGrants'), accessTokenHash: v.string(), refreshTokenHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.grantId, {
      codeHash: undefined,
      codeExpiresAt: undefined,
      codeChallenge: undefined,
      accessTokenHash: args.accessTokenHash,
      refreshTokenHash: args.refreshTokenHash,
    });
  },
});

export const findGrantByRefreshTokenHash = internalQuery({
  args: { refreshTokenHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('oauthGrants')
      .withIndex('by_refreshTokenHash', (q) => q.eq('refreshTokenHash', args.refreshTokenHash))
      .unique();
  },
});

/** Refresh rotation: overwrite both hashes — the presented refresh token stops
 * matching anything the instant this commits, so it cannot be replayed. */
export const rotateTokens = internalMutation({
  args: { grantId: v.id('oauthGrants'), accessTokenHash: v.string(), refreshTokenHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.grantId, {
      accessTokenHash: args.accessTokenHash,
      refreshTokenHash: args.refreshTokenHash,
    });
  },
});

export const findGrantByAccessTokenHash = internalQuery({
  args: { accessTokenHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('oauthGrants')
      .withIndex('by_accessTokenHash', (q) => q.eq('accessTokenHash', args.accessTokenHash))
      .unique();
  },
});

/** Fixed-window rate check for atlas_oat_ tokens (convex/lib/rateLimit.ts) — the
 * same algorithm as apiKeys' recordUse (convex/internal/mcpAuth.ts), no
 * lastUsedAt bump (grants don't surface a "last used" affordance; 06 §4). */
export const recordUse = internalMutation({
  args: { grantId: v.id('oauthGrants'), now: v.number() },
  handler: async (ctx, args): Promise<RateLimitResult> => {
    const row = await ctx.db.get(args.grantId);
    if (row === null) return { allowed: true, patch: { rateWindowStart: args.now, rateWindowCount: 1 } };

    const result = checkRateLimit(row, args.now);
    if (!result.allowed) return result;

    await ctx.db.patch(args.grantId, result.patch);
    return result;
  },
});
