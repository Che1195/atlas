// HTTP router (Phase M Tasks 4-5). ROUTING ONLY — scripts/check-invariants.sh
// exempts this file by name from the userId-arg lint, so nothing beyond route
// wiring may live here; all protocol/auth/tool logic is in convex/mcp/*, all
// OAuth AS logic is in convex/oauth/*.
import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { handleMcpRequest } from './mcp/server';
import { authorizationServerMetadata, jsonResponse, protectedResourceMetadata } from './oauth/metadata';
import { handleRegister } from './oauth/register';
import { handleToken } from './oauth/token';

const http = httpRouter();

http.route({
  path: '/mcp',
  method: 'POST',
  handler: httpAction(async (ctx, request) => handleMcpRequest(ctx, request)),
});

http.route({
  path: '/mcp',
  method: 'GET',
  handler: httpAction(async () => new Response(null, { status: 405, headers: { Allow: 'POST' } })),
});

// RFC 8414 authorization server metadata.
http.route({
  path: '/.well-known/oauth-authorization-server',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => jsonResponse(authorizationServerMetadata(request))),
});

// RFC 9728 protected resource metadata.
http.route({
  path: '/.well-known/oauth-protected-resource',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => jsonResponse(protectedResourceMetadata(request))),
});

// RFC 9728 §3.1 path-inserted form for resource `/mcp` — the WWW-Authenticate
// `resource_metadata` value the /mcp 401 path advertises (convex/mcp/server.ts).
// Same handler/body as the root path above; both are valid discovery locations.
http.route({
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => jsonResponse(protectedResourceMetadata(request))),
});

// RFC 7591 open Dynamic Client Registration.
http.route({
  path: '/oauth/register',
  method: 'POST',
  handler: httpAction(async (ctx, request) => handleRegister(ctx, request)),
});

// RFC 6749 §4.1.3/§6 token endpoint (authorization_code exchange + refresh rotation).
http.route({
  path: '/oauth/token',
  method: 'POST',
  handler: httpAction(async (ctx, request) => handleToken(ctx, request)),
});

export default http;
