// Shared validation for the OAuth AS surface (Phase M Task 5).

/** RFC 7591 DCR redirect_uris: https, or localhost/127.0.0.1 (any scheme/port —
 * covers native/CLI clients bouncing through a loopback listener during dev). */
export function isValidRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  const host = parsed.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
