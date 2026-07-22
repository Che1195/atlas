// POST /oauth/token — RFC 6749 §4.1.3 authorization_code exchange (mandatory
// PKCE S256, RFC 7636) and §6 refresh_token rotation. Phase M Task 5.
//
// Access tokens never expire server-side (no accessTokenExpiresAt field in
// oauthGrants) — same model as apiKeys: revocation is the only way a token
// stops working, matched by the same fixed-window rate limit
// (convex/internal/oauthStore.ts's recordUse). The token response therefore
// omits `expires_in` rather than advertising an expiry Atlas doesn't enforce
// (05/08's honesty-over-stubbed-claims convention).
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { randomHex } from '../lib/randomHex';
import { sha256Hex } from '../mcp/auth';
import { oauthErrorResponse } from './errors';
import { jsonResponse } from './metadata';
import { pkceMatches } from './pkce';

/** ≤60s single-use TTL (06 §1). */
const CODE_TTL_MS = 60_000;

type TokenPair = { accessToken: string; refreshToken: string; accessTokenHash: string; refreshTokenHash: string };

async function issueTokenPair(): Promise<TokenPair> {
  const accessToken = `atlas_oat_${randomHex(20)}`;
  const refreshToken = `atlas_ort_${randomHex(20)}`;
  return {
    accessToken,
    refreshToken,
    accessTokenHash: await sha256Hex(accessToken),
    refreshTokenHash: await sha256Hex(refreshToken),
  };
}

function tokenResponse(tokens: TokenPair, scopes: string[]): Response {
  return jsonResponse({
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    refresh_token: tokens.refreshToken,
    scope: scopes.join(' '),
  });
}

async function handleAuthorizationCode(ctx: ActionCtx, params: URLSearchParams): Promise<Response> {
  const code = params.get('code');
  const codeVerifier = params.get('code_verifier');
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  if (code === null || codeVerifier === null || clientId === null || redirectUri === null) {
    return oauthErrorResponse(
      400,
      'invalid_request',
      'code, code_verifier, client_id, and redirect_uri are all required.',
    );
  }

  const codeHash = await sha256Hex(code);
  const grant = await ctx.runQuery(internal.internal.oauthStore.findGrantByCodeHash, { codeHash });
  if (grant === null || grant.codeExpiresAt === undefined || grant.codeChallenge === undefined) {
    // Covers: never issued, already exchanged (single-use — codeHash is cleared
    // on exchange, so a reused code simply misses this lookup), or otherwise dead.
    return oauthErrorResponse(400, 'invalid_grant', 'Unknown or already-used authorization code.');
  }

  if (grant.clientId !== clientId || grant.redirectUri !== redirectUri) {
    // Possible misuse (code issued for a different client/redirect) — burn it.
    await ctx.runMutation(internal.internal.oauthStore.consumeCode, { grantId: grant._id });
    return oauthErrorResponse(400, 'invalid_grant', 'client_id or redirect_uri does not match the authorization request.');
  }

  if (Date.now() > grant.codeExpiresAt) {
    await ctx.runMutation(internal.internal.oauthStore.consumeCode, { grantId: grant._id });
    return oauthErrorResponse(400, 'invalid_grant', 'Authorization code has expired.');
  }

  if (!(await pkceMatches(codeVerifier, grant.codeChallenge))) {
    // A failed PKCE check burns the code too — no verifier-guessing retry loop.
    await ctx.runMutation(internal.internal.oauthStore.consumeCode, { grantId: grant._id });
    return oauthErrorResponse(400, 'invalid_grant', 'code_verifier does not match code_challenge.');
  }

  const tokens = await issueTokenPair();
  await ctx.runMutation(internal.internal.oauthStore.exchangeCode, {
    grantId: grant._id,
    accessTokenHash: tokens.accessTokenHash,
    refreshTokenHash: tokens.refreshTokenHash,
  });
  return tokenResponse(tokens, grant.scopes);
}

async function handleRefreshToken(ctx: ActionCtx, params: URLSearchParams): Promise<Response> {
  const refreshToken = params.get('refresh_token');
  if (refreshToken === null) {
    return oauthErrorResponse(400, 'invalid_request', 'refresh_token is required.');
  }

  const refreshTokenHash = await sha256Hex(refreshToken);
  const grant = await ctx.runQuery(internal.internal.oauthStore.findGrantByRefreshTokenHash, { refreshTokenHash });
  if (grant === null || grant.revokedAt !== undefined) {
    return oauthErrorResponse(400, 'invalid_grant', 'Unknown, revoked, or already-rotated refresh token.');
  }

  const clientId = params.get('client_id');
  if (clientId !== null && clientId !== grant.clientId) {
    return oauthErrorResponse(400, 'invalid_grant', 'client_id does not match this refresh token.');
  }

  // Rotate: overwrite both hashes so the presented refresh token is dead the
  // instant this commits — it can never be replayed (06 §1: "refresh tokens rotate").
  const tokens = await issueTokenPair();
  await ctx.runMutation(internal.internal.oauthStore.rotateTokens, {
    grantId: grant._id,
    accessTokenHash: tokens.accessTokenHash,
    refreshTokenHash: tokens.refreshTokenHash,
  });
  return tokenResponse(tokens, grant.scopes);
}

export async function handleToken(ctx: ActionCtx, request: Request): Promise<Response> {
  const bodyText = await request.text();
  const params = new URLSearchParams(bodyText);

  const grantType = params.get('grant_type');
  if (grantType === 'authorization_code') return handleAuthorizationCode(ctx, params);
  if (grantType === 'refresh_token') return handleRefreshToken(ctx, params);
  return oauthErrorResponse(
    400,
    'unsupported_grant_type',
    `grant_type must be authorization_code or refresh_token; got ${JSON.stringify(grantType)}.`,
  );
}

// Exported for the contract suite (ties the endpoint's TTL constant to the
// tests that assert an expired code is rejected).
export { CODE_TTL_MS };
