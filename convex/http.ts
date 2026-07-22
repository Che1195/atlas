// HTTP router (Phase M Task 4). ROUTING ONLY — scripts/check-invariants.sh exempts
// this file by name from the userId-arg lint, so nothing beyond route wiring may
// live here; all protocol/auth/tool logic is in convex/mcp/*.
import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { handleMcpRequest } from './mcp/server';

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

export default http;
