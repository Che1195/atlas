// CSPRNG hex generator shared by every place Atlas mints a secret: API keys
// (atlas_sk_), OAuth client ids, authorization codes, access/refresh tokens
// (atlas_oat_/atlas_ort_). `crypto.getRandomValues` is available in both the
// default and "use node" action runtimes (and in httpActions, which are
// actions) — see convex/mcp/auth.ts's sha256Hex for the same-family primitive
// already relied on there.
export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
