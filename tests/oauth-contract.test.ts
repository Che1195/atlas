/// <reference types="vite/client" />
// OAuth 2.1 + DCR contract suite (Phase M Task 5, docs/spec/06-mcp-interface.md
// §1, ADR-0012). Drives the real httpAction routes via convex-test's `t.fetch`
// (same approach as tests/mcp-contract.test.ts) for the AS endpoints, and calls
// `oauth.grants.approveGrant` directly with a test identity as the consent-UI
// stand-in (the brief's "test bypasses UI via internal issue with test user" —
// approveGrant IS that seam, a public action, not UI).
process.env.AI_PROVIDER = 'stub';

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import { sha256Hex } from '../convex/mcp/auth';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);

type World = TestConvex<typeof schema>;
type ScopeName = 'read' | 'capture' | 'propose';

const USER_A = { subject: 'clerk_oauth_user_a', name: 'OAuth User A' };

// PKCE helpers, computed independently of convex/oauth/pkce.ts's implementation
// (same primitives — crypto.subtle + base64url — but a separate code path, so
// a bug shared between "generate" and "verify" isn't self-confirming).
function randomVerifier(): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return out;
}

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function registerClient(
  t: World,
  redirectUris: string[] = ['https://client.example/callback'],
): Promise<{ clientId: string; redirectUris: string[] }> {
  const response = await t.fetch('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: redirectUris, client_name: 'Test Client' }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string; redirect_uris: string[] };
  return { clientId: body.client_id, redirectUris: body.redirect_uris };
}

async function approve(
  t: World,
  identity: { subject: string; name: string },
  args: { clientId: string; redirectUri: string; scopes: ScopeName[]; codeChallenge: string },
): Promise<string> {
  const as = t.withIdentity(identity);
  await as.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const { code } = await as.action(api.oauth.grants.approveGrant, args);
  return code;
}

function exchangeCode(t: World, params: Record<string, string>): Promise<Response> {
  return t.fetch('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

/** Full happy-path setup shared by several tests: register + approve + exchange. */
async function fullExchange(t: World, scopes: ScopeName[]) {
  const { clientId, redirectUris } = await registerClient(t);
  const redirectUri = redirectUris[0]!;
  const verifier = randomVerifier();
  const challenge = await s256Challenge(verifier);
  const code = await approve(t, USER_A, { clientId, redirectUri, scopes, codeChallenge: challenge });
  const response = await exchangeCode(t, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  return { clientId, redirectUri, verifier, challenge, code, response };
}

describe('metadata endpoints', () => {
  it('serves RFC 8414 authorization server metadata', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/.well-known/oauth-authorization-server', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(body.registration_endpoint).toMatch(/\/oauth\/register$/);
    expect(body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(body.scopes_supported).toEqual(['read', 'capture', 'propose']);
  });

  it('serves RFC 9728 protected resource metadata', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/.well-known/oauth-protected-resource', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
    expect(body.resource).toMatch(/\/mcp$/);
  });

  it('also serves protected resource metadata at the RFC 9728 §3.1 path-inserted /mcp route', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/.well-known/oauth-protected-resource/mcp', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toMatch(/\/mcp$/);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
  });
});

describe('dynamic client registration', () => {
  it('registers a public client', async () => {
    const t = convexTest(schema, modules);
    const { clientId, redirectUris } = await registerClient(t);
    expect(clientId).toMatch(/^atlas_client_/);
    expect(redirectUris).toEqual(['https://client.example/callback']);
  });

  it('rejects a non-https, non-localhost redirect_uri', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('rejects a confidential-client auth method', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://client.example/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('rejects more than 10 redirect_uris as invalid_client_metadata', async () => {
    const t = convexTest(schema, modules);
    const tooMany = Array.from({ length: 11 }, (_, i) => `https://client.example/cb${i}`);
    const response = await t.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: tooMany }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('rejects a redirect_uri over 2048 chars as invalid_client_metadata', async () => {
    const t = convexTest(schema, modules);
    const overlong = `https://client.example/${'a'.repeat(2048)}`;
    const response = await t.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [overlong] }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('rejects a client_name over 200 chars as invalid_client_metadata', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://client.example/cb'],
        client_name: 'a'.repeat(201),
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_client_metadata');
  });
});

describe('full authorization_code dance', () => {
  it('register -> approve -> exchange -> tools/call succeeds within scope, forbidden outside it', async () => {
    const t = convexTest(schema, modules);
    const { response } = await fullExchange(t, ['read', 'capture']);
    expect(response.status).toBe(200);
    const tokenBody = (await response.json()) as {
      access_token: string;
      token_type: string;
      refresh_token: string;
      scope: string;
    };
    expect(tokenBody.access_token).toMatch(/^atlas_oat_/);
    expect(tokenBody.refresh_token).toMatch(/^atlas_ort_/);
    expect(tokenBody.token_type).toBe('Bearer');
    expect(tokenBody.scope).toBe('read capture');

    const listResponse = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenBody.access_token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'atlas_list_entries', arguments: {} },
      }),
    });
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { result: { isError?: boolean } };
    expect(listBody.result.isError).toBeUndefined();

    const submitResponse = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenBody.access_token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'atlas_submit_proposal', arguments: { ops: [], rationale: 'x', citations: [] } },
      }),
    });
    expect(submitResponse.status).toBe(200);
    const submitBody = (await submitResponse.json()) as {
      result: { isError: boolean; content: { type: string; text: string }[] };
    };
    expect(submitBody.result.isError).toBe(true);
    const errorPayload = JSON.parse(submitBody.result.content[0]!.text) as { code: string };
    expect(errorPayload.code).toBe('forbidden_scope');
  });

  it('rejects a PKCE mismatch as invalid_grant and burns the code (no retry with the correct verifier)', async () => {
    const t = convexTest(schema, modules);
    const { clientId, redirectUris } = await registerClient(t);
    const redirectUri = redirectUris[0]!;
    const verifier = randomVerifier();
    const challenge = await s256Challenge(verifier);
    const code = await approve(t, USER_A, { clientId, redirectUri, scopes: ['read'], codeChallenge: challenge });

    const wrongVerifier = randomVerifier();
    const mismatch = await exchangeCode(t, {
      grant_type: 'authorization_code',
      code,
      code_verifier: wrongVerifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: string }).error).toBe('invalid_grant');

    const retry = await exchangeCode(t, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    expect(retry.status).toBe(400);
  });

  it('rejects a reused authorization code', async () => {
    const t = convexTest(schema, modules);
    const { clientId, redirectUris } = await registerClient(t);
    const redirectUri = redirectUris[0]!;
    const verifier = randomVerifier();
    const challenge = await s256Challenge(verifier);
    const code = await approve(t, USER_A, { clientId, redirectUri, scopes: ['read'], codeChallenge: challenge });

    const params = { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri };
    const first = await exchangeCode(t, params);
    expect(first.status).toBe(200);

    const second = await exchangeCode(t, params);
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects an expired authorization code', async () => {
    const t = convexTest(schema, modules);
    const { clientId, redirectUris } = await registerClient(t);
    const redirectUri = redirectUris[0]!;
    const verifier = randomVerifier();
    const challenge = await s256Challenge(verifier);
    const code = await approve(t, USER_A, { clientId, redirectUri, scopes: ['read'], codeChallenge: challenge });

    // The real TTL is 60s — force expiry directly rather than sleeping in a test.
    await t.run(async (ctx) => {
      const codeHash = await sha256Hex(code);
      const grant = await ctx.db
        .query('oauthGrants')
        .withIndex('by_codeHash', (q) => q.eq('codeHash', codeHash))
        .unique();
      await ctx.db.patch(grant!._id, { codeExpiresAt: Date.now() - 1 });
    });

    const response = await exchangeCode(t, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rotates refresh tokens: the old one dies, the new one works', async () => {
    const t = convexTest(schema, modules);
    const { response } = await fullExchange(t, ['read']);
    const firstBody = (await response.json()) as { access_token: string; refresh_token: string };

    const rotatedResponse = await exchangeCode(t, { grant_type: 'refresh_token', refresh_token: firstBody.refresh_token });
    expect(rotatedResponse.status).toBe(200);
    const rotated = (await rotatedResponse.json()) as { access_token: string; refresh_token: string };
    expect(rotated.access_token).not.toBe(firstBody.access_token);
    expect(rotated.refresh_token).not.toBe(firstBody.refresh_token);

    const reuseOld = await exchangeCode(t, { grant_type: 'refresh_token', refresh_token: firstBody.refresh_token });
    expect(reuseOld.status).toBe(400);

    const useNew = await exchangeCode(t, { grant_type: 'refresh_token', refresh_token: rotated.refresh_token });
    expect(useNew.status).toBe(200);
  });

  it('a revoked grant is rejected with 401 on tools/call', async () => {
    const t = convexTest(schema, modules);
    const { response } = await fullExchange(t, ['read']);
    const { access_token } = (await response.json()) as { access_token: string };

    await t.run(async (ctx) => {
      const accessTokenHash = await sha256Hex(access_token);
      const grant = await ctx.db
        .query('oauthGrants')
        .withIndex('by_accessTokenHash', (q) => q.eq('accessTokenHash', accessTokenHash))
        .unique();
      await ctx.db.patch(grant!._id, { revokedAt: Date.now() });
    });

    const mcpResponse = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcpResponse.status).toBe(401);
  });
});

describe('atomic code consumption (internal mutation)', () => {
  // The httpAction-level "reused code" test above already proves the end-to-end
  // behavior for two SEQUENTIAL exchanges. This test exercises the internal
  // mutation directly to simulate the race a naive query-then-separate-mutation
  // design would lose: two calls presenting the same codeHash, back to back,
  // with no re-fetch in between (i.e. as if both had already read the grant and
  // computed pkceOk before either one committed — the worst case for a
  // non-atomic implementation). finalizeAuthorizationCode must let exactly one
  // through and report the other as a plain 'not_found' conflict.
  it('a second finalize call against an already-consumed grant reports not_found, not a second success', async () => {
    const t = convexTest(schema, modules);
    const { clientId, redirectUris } = await registerClient(t);
    const redirectUri = redirectUris[0]!;
    const verifier = randomVerifier();
    const challenge = await s256Challenge(verifier);
    const code = await approve(t, USER_A, { clientId, redirectUri, scopes: ['read'], codeChallenge: challenge });
    const codeHash = await sha256Hex(code);

    const baseArgs = { codeHash, clientId, redirectUri, now: Date.now(), pkceOk: true };

    const first = await t.mutation(internal.internal.oauthStore.finalizeAuthorizationCode, {
      ...baseArgs,
      accessTokenHash: 'race-test-access-hash-1',
      refreshTokenHash: 'race-test-refresh-hash-1',
    });
    expect(first.ok).toBe(true);

    // Same codeHash, as if a concurrent duplicate request had raced the first —
    // must be rejected, not silently mint a second token pair.
    const second = await t.mutation(internal.internal.oauthStore.finalizeAuthorizationCode, {
      ...baseArgs,
      accessTokenHash: 'race-test-access-hash-2',
      refreshTokenHash: 'race-test-refresh-hash-2',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('not_found');

    // And the grant's tokens are still the FIRST call's, not overwritten by the second.
    const grant = await t.run(async (ctx) =>
      ctx.db
        .query('oauthGrants')
        .withIndex('by_accessTokenHash', (q) => q.eq('accessTokenHash', 'race-test-access-hash-1'))
        .unique(),
    );
    expect(grant).not.toBeNull();
  });
});
