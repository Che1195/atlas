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

// RFC 7591 leaves these caps to the AS; chosen generously enough for any real
// client (a client juggling 10 redirect URIs, or a 2048-char one, is already
// pathological) while bounding what an open, unauthenticated endpoint stores.
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2048;
const MAX_CLIENT_NAME_LENGTH = 200;

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
  // Input caps (Task 5 final-review finding): an open DCR endpoint accepts
  // registration from any client, so unbounded array/string sizes are a stored
  // amplification vector — cap before any further validation runs.
  if (redirect_uris.length > MAX_REDIRECT_URIS) {
    return oauthErrorResponse(
      400,
      'invalid_client_metadata',
      `redirect_uris must contain at most ${MAX_REDIRECT_URIS} entries.`,
    );
  }
  if (redirect_uris.some((u) => u.length > MAX_REDIRECT_URI_LENGTH)) {
    return oauthErrorResponse(
      400,
      'invalid_client_metadata',
      `Each redirect_uri must be at most ${MAX_REDIRECT_URI_LENGTH} characters.`,
    );
  }
  if (typeof client_name === 'string' && client_name.length > MAX_CLIENT_NAME_LENGTH) {
    return oauthErrorResponse(
      400,
      'invalid_client_metadata',
      `client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters.`,
    );
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
