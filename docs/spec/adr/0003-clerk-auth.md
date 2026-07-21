# ADR-0003: Clerk for human authentication

Status: Accepted

## Context
Auth is MVP P0. Convex has first-class integrations for Clerk; the preferred stack names Clerk; requirements are modest (email OTP + passkeys, session for a PWA, JWT into Convex).

## Decision
Clerk with email-code + passkeys (no passwords), JWT template into Convex, lazy user provisioning via `ensureUser` (no webhooks in MVP).

## Consequences
- Display name captured at signup as a required progressive field (playbook identity rule).
- Separate dev/prod Clerk instances mirror the Convex environments.
- Lazy provisioning avoids a public webhook endpoint and first-load races; profile drift (rare email changes) re-syncs on any `ensureUser` call. Webhook sync only if drift becomes a real problem.
- Machine access (MCP) deliberately does NOT use Clerk — separate bearer-key plane (ADR-0007, 08 §3), so a Clerk change never breaks Hermes and vice versa.
