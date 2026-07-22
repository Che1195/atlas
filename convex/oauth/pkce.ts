// PKCE S256 (RFC 7636 §4.6) — Phase M Task 5. Mandatory on every code exchange
// (06 §1: "mandatory PKCE (S256)"); Atlas never implements the weaker 'plain'
// method.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** code_challenge = BASE64URL(SHA256(code_verifier)) */
export async function pkceMatches(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest)) === codeChallenge;
}
