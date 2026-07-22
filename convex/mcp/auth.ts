// MCP bearer resolution (Phase M Task 4, docs/spec/06 §1, 08 §3). Runs inside the
// /mcp httpAction (convex/http.ts -> convex/mcp/server.ts), which has NO ctx.db —
// every lookup goes through convex/internal/mcpAuth.ts via ctx.runQuery/runMutation.
//
// Every request to /mcp authenticates fresh (06 §4: "stateless — every call
// authenticates the bearer key fresh"), including initialize/tools-list — there is
// no session, so there is nothing to reuse.
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { RATE_LIMIT_MAX_PER_WINDOW } from '../internal/mcpAuth';
import type { StructuredError } from './errors';

export type Scope = 'read' | 'capture' | 'propose';

// keyId is either an apiKeys row id (bearer path) or an oauthGrants row id
// (OAuth path, Phase M Task 5) — both are opaque strings to every downstream
// consumer (e.g. atlas_submit_proposal's runId string interpolation), so a
// union costs nothing at call sites while keeping each auth path's own id type.
export type ResolvedAuth = {
  userId: Id<'users'>;
  scopes: Scope[];
  keyId: Id<'apiKeys'> | Id<'oauthGrants'>;
};

export type AuthFailure = {
  httpStatus: 401 | 429;
  error: StructuredError;
  retryAfterSeconds?: number;
};

export type AuthResult = { ok: true; auth: ResolvedAuth } | { ok: false; failure: AuthFailure };

function unauthorized(message: string, details?: unknown): AuthResult {
  return { ok: false, failure: { httpStatus: 401, error: { code: 'unauthorized', message, details } } };
}

/** SHA-256 hex digest via Web Crypto (crypto.subtle — available in httpActions). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function resolveBearerKey(ctx: ActionCtx, token: string): Promise<AuthResult> {
  const keyHash = await sha256Hex(token);
  const row = await ctx.runQuery(internal.internal.mcpAuth.findByHash, { keyHash });
  if (row === null || row.revokedAt !== undefined) {
    return unauthorized('Invalid or revoked API key.');
  }

  const rateResult = await ctx.runMutation(internal.internal.mcpAuth.recordUse, {
    keyId: row._id,
    now: Date.now(),
  });
  if (!rateResult.allowed) {
    return {
      ok: false,
      failure: {
        httpStatus: 429,
        error: {
          code: 'rate_limited',
          message: `Rate limit exceeded (${RATE_LIMIT_MAX_PER_WINDOW}/min). Retry after the window resets.`,
        },
        retryAfterSeconds: rateResult.retryAfterSeconds,
      },
    };
  }

  return {
    ok: true,
    auth: { userId: row.userId, scopes: row.scopes as Scope[], keyId: row._id },
  };
}

/**
 * OAuth access-token resolution (Phase M Task 5, docs/spec/06 §1): `atlas_oat_`
 * tokens hash-lookup against `oauthGrants.by_accessTokenHash` the same way
 * bearer keys hash-lookup against `apiKeys.by_hash` — a global (non-userId-led)
 * index, since the hash itself is the only thing that needs verifying (08 §3).
 * `keyId` carries the grant id so atlas_submit_proposal's idempotence runId
 * still has a stable per-credential identifier to key off of.
 */
async function resolveOAuthToken(ctx: ActionCtx, token: string): Promise<AuthResult> {
  const tokenHash = await sha256Hex(token);
  const grant = await ctx.runQuery(internal.internal.oauthStore.findGrantByAccessTokenHash, {
    accessTokenHash: tokenHash,
  });
  if (grant === null || grant.revokedAt !== undefined) {
    return unauthorized('Invalid or revoked access token.');
  }

  const rateResult = await ctx.runMutation(internal.internal.oauthStore.recordUse, {
    grantId: grant._id,
    now: Date.now(),
  });
  if (!rateResult.allowed) {
    return {
      ok: false,
      failure: {
        httpStatus: 429,
        error: {
          code: 'rate_limited',
          message: `Rate limit exceeded (${RATE_LIMIT_MAX_PER_WINDOW}/min). Retry after the window resets.`,
        },
        retryAfterSeconds: rateResult.retryAfterSeconds,
      },
    };
  }

  return {
    ok: true,
    auth: { userId: grant.userId, scopes: grant.scopes as Scope[], keyId: grant._id },
  };
}

export async function resolveAuth(ctx: ActionCtx, request: Request): Promise<AuthResult> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (header === null) return unauthorized('Missing Authorization header.');

  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (match === null) return unauthorized('Authorization header must be "Bearer <token>".');
  const token = match[1]!;

  if (token.startsWith('atlas_sk_')) {
    return resolveBearerKey(ctx, token);
  }
  if (token.startsWith('atlas_oat_')) {
    return resolveOAuthToken(ctx, token);
  }
  return unauthorized('Unrecognized token format.');
}
