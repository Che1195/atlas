// MCP structured error taxonomy (docs/spec/06-mcp-interface.md §2: "Errors are
// structured: { code: 'not_found' | 'forbidden_scope' | 'invalid_ops' |
// 'budget_exceeded' | 'rate_limited', message, details? }" + 'unauthorized' for
// the auth layer (Task 4 brief)). This is the ONLY error vocabulary tool handlers
// and the auth/protocol layer may use when talking to the MCP client — Convex's
// own ConvexError codes (invalid_input, not_found, etc. from convex/lib/*) never
// leak through directly; handlers translate.

export type StructuredErrorCode =
  | 'not_found'
  | 'forbidden_scope'
  | 'invalid_ops'
  | 'budget_exceeded'
  | 'rate_limited'
  | 'unauthorized';

export type StructuredError = {
  code: StructuredErrorCode;
  message: string;
  details?: unknown;
};

/** Thrown by tool handlers; caught at the tools/call dispatch boundary (mcp/server.ts)
 * and turned into a `{ isError: true, content }` tool result (MCP convention) —
 * never a JSON-RPC protocol-level error, since the tool call itself succeeded as
 * an RPC, only its domain outcome failed. */
export class ToolError extends Error {
  readonly code: StructuredErrorCode;
  readonly details?: unknown;
  constructor(code: StructuredErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }

  toStructured(): StructuredError {
    return { code: this.code, message: this.message, details: this.details };
  }
}
