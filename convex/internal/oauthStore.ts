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

export type FinalizeAuthorizationCodeReason = 'not_found' | 'client_mismatch' | 'expired' | 'pkce_mismatch';

export type FinalizeAuthorizationCodeResult =
  | { ok: true; scopes: ('read' | 'capture' | 'propose')[] }
  | { ok: false; reason: FinalizeAuthorizationCodeReason };

/**
 * Atomic validate-then-consume for the authorization_code grant (RFC 6749
 * §4.1.3, PKCE RFC 7636). MUST stay a single mutation: an earlier version had
 * convex/oauth/token.ts read the grant (query) and then validate/consume it
 * via separate mutations (consumeCode/exchangeCode) — two transactions with a
 * window in between where two concurrent exchanges of the same code could
 * both pass validation before either had consumed it (a real double-spend:
 * two token pairs minted from one code). Doing the re-read, every check, and
 * the consuming patch inside ONE mutation makes Convex's transactional
 * optimistic-concurrency-control the enforcement: two concurrent calls that
 * touch the same grant document conflict, one commits and one is retried: the
 * retry re-runs this handler from the top, and its re-read by `codeHash` (the
 * very first line) now sees the row the winner already cleared -> 'not_found'.
 * A concurrent duplicate exchange therefore always gets exactly one winner.
 *
 * PKCE verification itself (crypto.subtle.digest) can't run in a mutation, so
 * the calling action computes `pkceOk` beforehand from the codeChallenge it
 * read via a separate (non-authoritative) query, and passes just the boolean
 * result in. That's safe: codeChallenge only ever transitions from
 * present -> cleared (this same mutation is the only writer, and it clears it
 * unconditionally), never changes value while present, so a `pkceOk` computed
 * against a still-present challenge is valid for whatever this mutation reads
 * moments later — it is never stale in a way that flips true/false.
 */
export const finalizeAuthorizationCode = internalMutation({
  args: {
    codeHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    now: v.number(),
    pkceOk: v.boolean(),
    accessTokenHash: v.string(),
    refreshTokenHash: v.string(),
  },
  handler: async (ctx, args): Promise<FinalizeAuthorizationCodeResult> => {
    const grant = await ctx.db
      .query('oauthGrants')
      .withIndex('by_codeHash', (q) => q.eq('codeHash', args.codeHash))
      .unique();
    if (grant === null || grant.codeExpiresAt === undefined || grant.codeChallenge === undefined) {
      // Never issued, already consumed by a winning concurrent call, or
      // otherwise dead — codeHash is cleared the instant a grant is consumed,
      // so a reused or raced code simply misses this lookup.
      return { ok: false, reason: 'not_found' };
    }

    const burn = () =>
      ctx.db.patch(grant._id, { codeHash: undefined, codeExpiresAt: undefined, codeChallenge: undefined });

    if (grant.clientId !== args.clientId || grant.redirectUri !== args.redirectUri) {
      // Possible misuse (code presented against a different client/redirect) — burn it.
      await burn();
      return { ok: false, reason: 'client_mismatch' };
    }
    if (args.now > grant.codeExpiresAt) {
      await burn();
      return { ok: false, reason: 'expired' };
    }
    if (!args.pkceOk) {
      // A failed PKCE check burns the code too — no verifier-guessing retry loop.
      await burn();
      return { ok: false, reason: 'pkce_mismatch' };
    }

    await ctx.db.patch(grant._id, {
      codeHash: undefined,
      codeExpiresAt: undefined,
      codeChallenge: undefined,
      accessTokenHash: args.accessTokenHash,
      refreshTokenHash: args.refreshTokenHash,
    });
    return { ok: true, scopes: grant.scopes };
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
