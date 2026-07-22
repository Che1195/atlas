// MCP Streamable HTTP endpoint core (Phase M Task 4, docs/spec/06-mcp-interface.md
// §4). PROTOCOL DECISION (documented per the brief): implemented as a minimal
// JSON-RPC 2.0 subset directly, rather than composing `@modelcontextprotocol/sdk`'s
// StreamableHTTPServerTransport. That transport is built around Node's
// `http.IncomingMessage`/`ServerResponse` (and, for its stateful mode, SSE session
// state) — neither fits a Convex httpAction, which hands you a standard Web
// `Request` and expects a standard Web `Response` back, statelessly, per call.
// Bridging the SDK's Node-shaped transport into that would mean stubbing Node's
// http types just to satisfy an interface we don't need (no SSE, no sessions —
// 06 §4 explicitly wants stateless JSON). The subset below covers exactly what
// stateless MCP clients (ChatGPT connector, Codex CLI) exercise: `initialize`,
// `notifications/initialized`, `tools/list`, `tools/call`. Everything else is a
// JSON-RPC "method not found".
//
// This file (plus mcp/auth.ts, mcp/tools.ts, mcp/proposalSupport.ts, mcp/errors.ts)
// holds ALL protocol/business logic; convex/http.ts only routes to it (invariant
// note in the Task 4 brief — check-invariants.sh's userId-arg lint skips http.ts
// by name, so nothing subtle may hide there).
import { resolveAuth, type Scope } from './auth';
import { ToolError, type StructuredError } from './errors';
import { TOOLS } from './tools';
import type { ActionCtx } from '../_generated/server';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'atlas', version: '0.1.0' };

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).jsonrpc === '2.0' &&
    typeof (body as Record<string, unknown>).method === 'string'
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, result });
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } });
}

/** A JSON-RPC *notification* (no `id`) gets no response body — 202 Accepted. */
function isNotification(body: JsonRpcRequest): boolean {
  return body.id === undefined;
}

function structuredErrorContent(error: StructuredError) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(error) }],
  };
}

async function handleToolsCall(
  ctx: ActionCtx,
  auth: {
    userId: import('../_generated/dataModel').Id<'users'>;
    scopes: Scope[];
    keyId: import('../_generated/dataModel').Id<'apiKeys'> | import('../_generated/dataModel').Id<'oauthGrants'>;
  },
  id: JsonRpcId | undefined,
  params: unknown,
): Promise<Response> {
  if (typeof params !== 'object' || params === null || typeof (params as Record<string, unknown>).name !== 'string') {
    return rpcError(id, -32602, 'Invalid params: tools/call requires { name, arguments? }.');
  }
  const name = (params as Record<string, unknown>).name as string;
  const toolArgs = ((params as Record<string, unknown>).arguments ?? {}) as Record<string, unknown>;

  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }

  if (!auth.scopes.includes(tool.scope)) {
    return rpcResult(
      id,
      structuredErrorContent({
        code: 'forbidden_scope',
        message: `This tool requires the '${tool.scope}' scope, which this key does not have.`,
      }),
    );
  }

  try {
    const result = await tool.handler(ctx, auth.userId, toolArgs, auth.keyId);
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (err) {
    if (err instanceof ToolError) {
      return rpcResult(id, structuredErrorContent(err.toStructured()));
    }
    // Unexpected (non-ToolError) failure: surface as a generic structured error
    // rather than leaking internal error text/stack to the client.
    console.error(`mcp tool '${name}' failed unexpectedly`, err);
    return rpcResult(
      id,
      structuredErrorContent({ code: 'not_found', message: 'The tool call could not be completed.' }),
    );
  }
}

/** The core handler: POST /mcp -> Response. Exported for the contract suite
 * (convex/http.ts wires this to the httpAction; convex-test's t.fetch drives it
 * through the real router — see tests/mcp-contract.test.ts). */
export async function handleMcpRequest(ctx: ActionCtx, request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  // 06 §4: "every call authenticates the bearer key fresh" — no exemption for
  // initialize/tools-list; there is no session to have already authenticated.
  const authResult = await resolveAuth(ctx, request);
  if (!authResult.ok) {
    const { httpStatus, error, retryAfterSeconds } = authResult.failure;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (retryAfterSeconds !== undefined) headers['Retry-After'] = String(retryAfterSeconds);
    return new Response(JSON.stringify({ error }), { status: httpStatus, headers });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: request body must be valid JSON.');
  }

  if (!isJsonRpcRequest(body)) {
    return rpcError(null, -32600, 'Invalid Request: expected a JSON-RPC 2.0 request object.');
  }

  if (isNotification(body)) {
    // notifications/initialized (and any other notification) — accept, no body.
    return new Response(null, { status: 202 });
  }

  const { id, method, params } = body;

  switch (method) {
    case 'initialize': {
      const requested =
        typeof params === 'object' && params !== null
          ? (params as Record<string, unknown>).protocolVersion
          : undefined;
      const protocolVersion =
        typeof requested === 'string' &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    case 'tools/list': {
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }
    case 'tools/call': {
      return handleToolsCall(ctx, authResult.auth, id, params);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
