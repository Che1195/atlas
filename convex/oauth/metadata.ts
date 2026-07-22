// RFC 8414 (authorization server metadata) + RFC 9728 (protected resource
// metadata) — Phase M Task 5, docs/spec/06-mcp-interface.md §1. Pure request ->
// Response builders; convex/http.ts wires these as httpAction GET routes
// directly (no ctx needed — this is static-per-deployment metadata).

/** Convex sets CONVEX_SITE_URL automatically; request.url origin is the fallback
 * for local `convex dev` where that env var may be absent. This IS the issuer —
 * the AS's own identity — served from convex.site. Exported so convex/mcp/server.ts
 * can build the same origin for the 401 WWW-Authenticate header (Task 4/7 fix). */
export function siteOrigin(request: Request): string {
  return process.env.CONVEX_SITE_URL ?? new URL(request.url).origin;
}

/** The Vercel app origin — where the consent UI (app/(app)/oauth/authorize)
 * lives, DELIBERATELY not the same origin as the AS endpoints below (06 §1).
 * Same env var + fallback convex/mcp/tools.ts already uses for reviewUrl. */
const APP_URL = process.env.SITE_URL ?? 'https://atlas-phi-beige.vercel.app';

export function authorizationServerMetadata(request: Request): Record<string, unknown> {
  const issuer = siteOrigin(request);
  return {
    issuer,
    authorization_endpoint: `${APP_URL}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'capture', 'propose'],
  };
}

export function protectedResourceMetadata(request: Request): Record<string, unknown> {
  const issuer = siteOrigin(request);
  return {
    resource: new URL('/mcp', issuer).toString(),
    authorization_servers: [issuer],
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
