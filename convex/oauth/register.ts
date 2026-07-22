// POST /oauth/register — RFC 7591 open Dynamic Client Registration (Phase M
// Task 5, docs/spec/06-mcp-interface.md §1: "open Dynamic Client Registration").
// Any client may self-register; public clients only (`token_endpoint_auth_method:
// 'none'`) — Atlas never stores or checks a client secret.
import { internal } from '../_generated/api';
import { randomHex } from '../lib/randomHex';
import type { ActionCtx } from '../_generated/server';
import { oauthErrorResponse } from './errors';
import { jsonResponse } from './metadata';
import { isValidRedirectUri } from './validate';

export async function handleRegister(ctx: ActionCtx, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(400, 'invalid_client_metadata', 'Request body must be valid JSON.');
  }
  if (typeof body !== 'object' || body === null) {
    return oauthErrorResponse(400, 'invalid_client_metadata', 'Request body must be a JSON object.');
  }
  const { redirect_uris, client_name, token_endpoint_auth_method } = body as Record<string, unknown>;

  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0 || !redirect_uris.every((u) => typeof u === 'string')) {
    return oauthErrorResponse(400, 'invalid_redirect_uri', 'redirect_uris must be a non-empty array of strings.');
  }
  if (!redirect_uris.every(isValidRedirectUri)) {
    return oauthErrorResponse(
      400,
      'invalid_redirect_uri',
      'Every redirect_uri must be https, or http(s) on localhost/127.0.0.1.',
    );
  }
  if (token_endpoint_auth_method !== undefined && token_endpoint_auth_method !== 'none') {
    return oauthErrorResponse(
      400,
      'invalid_client_metadata',
      "Only token_endpoint_auth_method 'none' (public clients) is supported.",
    );
  }
  const name =
    typeof client_name === 'string' && client_name.trim().length > 0 ? client_name.trim() : 'Unnamed MCP client';

  const clientId = `atlas_client_${randomHex(16)}`;
  await ctx.runMutation(internal.internal.oauthStore.insertClient, {
    clientId,
    name,
    redirectUris: redirect_uris,
  });

  return jsonResponse(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris,
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}
