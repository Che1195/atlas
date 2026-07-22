// RFC 6749 §5.2 / RFC 7591 §3.2.2 error responses — a DIFFERENT vocabulary from
// convex/mcp/errors.ts's StructuredError (that's Atlas's own MCP tool-error
// shape; this is the OAuth spec's mandated `{error, error_description}` shape,
// since /oauth/token and /oauth/register are consumed by generic OAuth
// client libraries, not Atlas's own MCP client code).
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata';

export function oauthErrorResponse(status: number, error: OAuthErrorCode, description: string): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
