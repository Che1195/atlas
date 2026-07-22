# 08 — Security Model

Atlas stores a person's most sensitive self-knowledge. The security posture is: small attack surface, one isolation invariant enforced everywhere, honest accounting of accepted risks.

## 1. Threat model

| Threat | Posture |
|---|---|
| Cross-user data access | Primary invariant (§2); tested adversarially (11-testing §2) |
| Leaked MCP API key | Blast radius = that user, those scopes; revocable; hashed at rest; no knowledge-mutation tool exists even with full scopes |
| Prompt injection via entry content (a pasted conversation containing instructions) | Pipeline reads entries as data; structured-output post-filters (05 §3) bound what any model output can do — worst case is a bad *proposal*, which the human reviews. The proposal gate is the injection firewall. |
| XSS via markdown bodies | Render through a sanitizing markdown pipeline (no raw HTML pass-through); CSP with no `unsafe-inline` scripts |
| AI provider data handling | OpenAI API data is not used for training by default, per OpenAI's enterprise/API privacy policy. Documented in privacy note. No third-party analytics, ever (vision: privacy over engagement). |
| Convex/Clerk/Vercel compromise | Accepted platform risk; encryption at rest is theirs. Mitigation: user-side full export keeps exit always possible. |
| Device theft (PWA session) | Clerk session lifetime ≤ 30 days; biometric/passcode is the device's job; no offline knowledge cache beyond the capture draft |

## 2. Isolation invariant (the one rule)

Every Convex public function:
1. Resolves identity: `const user = await requireUser(ctx)` — reads `ctx.auth.getUserIdentity()`, maps `clerkId → users` row, throws if absent.
2. Queries only through indexes leading with `userId`, using `user._id` — **never a client-supplied user id**. No function signature anywhere accepts `userId`.
3. Document-id lookups (`db.get`) are followed by an ownership assertion (`doc.userId === user._id`) before any read of contents or any write.

The MCP path resolves `apiKey → userId` and enters the same internal functions with that id explicitly; internal functions take `userId` as their *first* parameter to make the subject visible at every call site (playbook: subject passed explicitly, never assumed).

This invariant is written in the header comment of `convex/lib/auth.ts` and enforced three ways: `requireUser` helper as the only auth entry point, a lint rule flagging `v.id('users')` in public function args, and the adversarial isolation test suite.

## 3. API key handling

- Generated server-side: `atlas_sk_` + 40 hex chars (160 bits) from a CSPRNG; plaintext returned exactly once.
- Stored: SHA-256 hash + display prefix. Lookup by hash index; constant-time compare not required (hash preimage is the secret).
- Revocation immediate (`revokedAt` checked per request). Rotation = revoke + create.
- Scope check per tool before handler dispatch; violations return `forbidden_scope`, are logged, and never partially execute.

## 4. Data protection & lifecycle

- **In transit:** TLS everywhere (Vercel, Convex, provider APIs).
- **At rest:** Convex-managed encryption. No additional client-side encryption in MVP — accepted risk, revisit if Atlas ever hosts other users' data at scale.
- **Export:** `account.exportAll` streams a single JSON document of every user-owned row (all tables, ids preserved). Always available, no cooldown. This is the anti-lock-in guarantee.
- **Deletion:** account deletion purges all rows across every table by `userId` (batched mutation), then deletes the Clerk user. Irreversible; confirmation flow per playbook's permanent-choice rule. Crash rows keep only a tombstoned user reference.
- **Backups:** Convex point-in-time recovery enabled on prod before any non-owner user (launch checklist).

## 5. Client hardening

- CSP: `default-src 'self'`; `connect-src` limited to Convex + Clerk domains; no third-party scripts.
- Sanitized markdown rendering (single shared component).
- Clerk handles session/CSRF; no custom cookies.
- Crash reporter scrubs: only message/stack/route/UA — never entry or knowledge content in `crashes` rows.

## 6. Accepted-risk register (playbook: written down, with revisit triggers)

| Accepted risk | Trigger to revisit |
|---|---|
| Open signup (anyone can create an account) | Before the URL leaves the owner's hands → invite-gate or allowlist |
| No email verification | Same trigger |
| No passkeys (Clerk Pro-tier; email OTP only) | Clerk plan upgrade, or before any non-owner user |
| Bearer keys instead of OAuth for MCP | If any third-party (non-Claude) client integration is wanted |
| No client-side encryption | If positioning ever becomes "we cannot read your data" |
| Single Convex region | Not expected to change for a personal tool |
