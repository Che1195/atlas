# ADR-0001: Mobile-first PWA over native app

Status: Accepted (user decision, 2026-07-21)

## Context
The vision names a "Mobile Application" as the client. Options: native (Expo/React Native), mobile-first PWA, desktop-first web.

## Decision
Mobile-first PWA: one Next.js codebase, installable, deployed on Vercel.

## Consequences
- One codebase, one deploy pipeline; playbook's iOS-PWA hardening list applies directly (budgeted as one deliberate pass, roadmap Phase 6).
- Accepted costs: no native push richness, PWA storage-container quirks (session must be established inside the installed app), keyboard/viewport fights on iOS (known mitigations catalogued).
- A native shell later would wrap the same Convex backend; nothing architectural blocks it.
