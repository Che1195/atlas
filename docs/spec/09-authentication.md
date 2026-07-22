# 09 — Authentication Strategy

Two authentication planes, deliberately separate:

1. **Humans → PWA:** Clerk (ADR-0003).
2. **Machines (Hermes/MCP clients) → Convex:** Atlas-issued bearer API keys (06 §1, 08 §3).

## 1. Clerk configuration

- **Instance per environment:** dev instance (dev Convex + previews) and prod instance (production), keys in Vercel/Convex env vars respectively.
- **Sign-in methods:** email code (OTP) + passkeys. No passwords (nothing to breach, nothing to forget). Google OAuth optional-on, decided at setup; adding later is trivial, removing later strands accounts — start with email+passkey only.
  - *Deviation (2026-07-21):* passkeys are a Clerk Pro-tier feature; the dev instance runs email code only for now. Revisit alongside the accepted-risk register triggers (08 §6) or if the plan upgrades.
- **Progressive sign-up field:** display name required at signup (playbook identity rule — email-prefix fallbacks fossilize). Stored in Clerk *and* mirrored to `users.displayName`.
- **Session:** 30-day lifetime, rolling. PWA standalone mode keeps the Clerk session in the PWA storage container — the playbook's Safari/PWA container split means sign-in must be completed *inside* the installed PWA at least once; onboarding copy says so explicitly.

## 2. Clerk ⇄ Convex wiring

Standard JWT integration:
- Clerk JWT template named `convex`; `auth.config.ts` lists the Clerk issuer domain + `applicationID: 'convex'`.
- Client: `ConvexProviderWithClerk` wraps the app; Convex client sends the Clerk JWT; `ctx.auth.getUserIdentity()` yields the verified identity in functions.
- **User provisioning — lazy, not webhook:** first authenticated call to `account.ensureUser` upserts the `users` row from the JWT claims (clerkId, email, name) + client-detected IANA timezone.
  - *Deviation (2026-07-21):* Clerk's first-class Convex integration (which replaced JWT
    templates — `/v1/jwt_templates` is empty) mints tokens WITHOUT the `name` claim, so
    `identity.name` is undefined server-side. The client therefore passes
    `displayName: user.fullName` from Clerk's client SDK as the designed fallback arg;
    `ensureUser` still prefers the claim if it ever appears. Regression-tested
    (tests/isolation.test.ts, "falls back to the displayName arg"). The token also omits
    the `email` claim (found 2026-07-22 by the E2E harness — the pre-clean guard's
    `+clerk_test` check was silently refusing on every run because `users.email` was
    always `''`). Same fix shape: the client passes
    `email: user.primaryEmailAddress?.emailAddress` as a fallback arg, and `ensureUser`
    re-syncs already-broken existing rows once the arg is available. Regression-tested
    (tests/isolation.test.ts, "falls back to the email arg" / "re-syncs an already-broken
    empty email").

  Chosen over Clerk webhooks: no public webhook endpoint to secure, no race on first load, one fewer moving part. A webhook is added post-MVP only if profile-sync drift becomes real (email changes are rare and re-synced on `ensureUser` anyway).
- Middleware: Next.js `clerkMiddleware` protects everything except `/`, sign-in routes, and static assets. The `/mcp` surface lives on Convex's domain, not Vercel — Clerk middleware never sees it (separate plane).

## 3. Route/function authorization matrix

| Surface | Principal | Mechanism |
|---|---|---|
| PWA pages | Clerk session | Next.js middleware redirect to sign-in |
| Convex public functions | Clerk JWT | `requireUser(ctx)` — every function, no exceptions |
| Convex `/mcp` httpAction | API key | hash lookup + scope check per tool |
| Convex internal functions | trusted callers only | not exported to clients; take explicit `userId` first param |
| Issue/crash write endpoints | Clerk JWT (crash: also pre-auth allowed with null user) | crash reports must survive auth failures |
| Ops/admin panel (owner) | Clerk JWT + `OWNER_CLERK_ID` env check | single-owner admin; no roles system in MVP |

## 4. Account lifecycle

- **Signup:** Clerk flow → `ensureUser` → onboarding (timezone confirm, review cadence defaults, capture-first empty state).
- **Permanent choices:** none at signup besides identity itself (deliberate — no role/type forks to regret). Account deletion is the one irreversible action and gets the full confirm treatment (typed confirmation + "this is permanent" copy).
- **Deletion:** `account.deleteAccount` purges Convex rows (08 §4) then deletes the Clerk user via backend SDK from a Convex action.
- **MCP keys:** managed in Settings → Connections (create named key, shown once; list with prefix + lastUsed; revoke). Creating keys requires a fresh Clerk session (< 10 min since auth) — cheap step-up for the highest-value credential.
