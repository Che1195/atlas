# Phase 2 — Verification Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright E2E infrastructure (Clerk test users, idempotent pre-clean, testid-only selectors) with suites covering auth/onboarding, the manual capture loop, the crash-prone paths the Phase 1 final review flagged, and cross-account isolation — plus the AI stub-provider flag, CI, and two spec corrections. Gate: the full pipeline including tagged E2E becomes the only way anything ships.

**Architecture:** E2E runs against the real dev stack: `next dev` (Playwright `webServer`, reuses a running server) talking to the cloud dev Convex deployment (`careful-vulture-415`) and the dev Clerk instance. Test identities are Clerk `+clerk_test` emails (dev-instance test mode: OTP `424242`, no real email). Pre-clean is an **internal** Convex mutation (`internal/testing:clearTestUser`) invoked via `bunx convex run` — internal functions are exempt from the isolation registry (it only walks `isPublic`) and from the userId-arg lint (script scans only top-level `convex/*.ts`), and the mutation refuses to touch any account whose email lacks `+clerk_test`.

**Tech Stack:** @playwright/test · @clerk/testing (`clerkSetup`, `setupClerkTestingToken`, `clerk.signIn`) · dotenv (Playwright config env) · Clerk Backend API (test-user provisioning/deletion) · existing Vitest/convex-test suites unchanged.

## Global Constraints

- Work on branch `phase-2-verification-harness`; PR to `main` at the end.
- E2E selectors: `data-testid` only for app UI (`page.getByTestId(...)`). Clerk's `<SignUp>` internals have no testids — use its stable input names (`emailAddress`, `firstName`, `lastName`, `code`) and `.cl-formButtonPrimary`, isolated in ONE helper so fragility is contained.
- Only `+clerk_test` emails may be created, signed in, or deleted by tests. The cleanup mutation and the Clerk-deletion helper must both enforce this (defense in depth); wiping a real account is the failure mode this guards.
- No real emails: dev-instance test mode, OTP `424242`.
- E2E is NOT added to `bun run pipeline` (unit layer must stay sub-second); it gets its own scripts (`test:e2e`, `test:e2e:batch`) and the pipeline docs list it as the pre-ship step (CLAUDE.md working rules already say `pipeline → tagged e2e → deploy`).
- Playwright `webServer` must set `reuseExistingServer: true` — the dev server is usually already running; never kill or restart it.
- No `Date.now()` in `convex/lib/**`; mutation handlers may use it. Schema stays locked.
- New PUBLIC Convex functions require isolation-registry rows — this plan adds none (the cleanup mutation is internal by design; do not make it public).
- After adding Convex modules run `bunx convex codegen`, commit regenerated `convex/_generated/api.d.ts`, and push functions to the dev deployment with `bunx convex dev --once` before running E2E (pre-clean calls the deployed mutation).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Spec corrections (docs only)

**Files:**
- Modify: `docs/spec/03-domain-model.md`, `docs/spec/09-authentication.md`

**Interfaces:** none — documentation. These record what Phase 1 shipping actually taught (final-review findings).

- [ ] **Step 1: 03 §5 — confidence precedence + dedup-stance note**

In `docs/spec/03-domain-model.md`, in §5 directly after the ```-fenced computation block (after the line ` C >= 2 && C > S:  contradicted`), append to the fence a precedence line so the block reads:

```
suggested =
  C == 0:            S == 0 → hypothesis; S == 1 → tentative; S in 2..3 → supported; S >= 4 → strong
  C > 0 && S > 2C:   mixed-leaning-supported → supported (UI shows the tension)
  C > 0 && S <= 2C:  mixed
  C >= 2 && C > S:   contradicted

Precedence (first match wins): C == 0 ladder → contradicted → supported → mixed.
(The contradicted guard must be checked before mixed: C >= 2 && C > S implies S <= 2C,
so a top-to-bottom reading of the cases above would never reach it.)
```

Then add one bullet to the §5 "Rules:" list:

```
- Dedup nuance: distinct-source collapsing happens per canonical source, so two evidence rows
  whose entries are linked by `duplicateOf` but carry OPPOSITE stances collapse to one source
  with a single stance (implementation: last row wins). Unreachable until the retelling UI can
  set `duplicateOf`; add a pinning test when it lands (logged 2026-07-21).
```

- [ ] **Step 2: 09 §2 — name-claim reality**

In `docs/spec/09-authentication.md` §2, in the "User provisioning" bullet, after the sentence ending "client-detected IANA timezone.", insert:

```
  - *Deviation (2026-07-21):* Clerk's first-class Convex integration (which replaced JWT
    templates — `/v1/jwt_templates` is empty) mints tokens WITHOUT the `name` claim, so
    `identity.name` is undefined server-side. The client therefore passes
    `displayName: user.fullName` from Clerk's client SDK as the designed fallback arg;
    `ensureUser` still prefers the claim if it ever appears. Regression-tested
    (tests/isolation.test.ts, "falls back to the displayName arg").
```

- [ ] **Step 3: Commit**

```bash
git add docs/spec/03-domain-model.md docs/spec/09-authentication.md
git commit -m "Spec: confidence precedence + dedup-stance note (03 §5); Convex-integration name-claim deviation (09 §2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Test-data cleanup mutation (internal, guarded)

**Files:**
- Create: `convex/internal/testing.ts`
- Test: `tests/testing-cleanup.test.ts`

**Interfaces:**
- Consumes: schema tables; `internalMutation` from `../_generated/server`.
- Produces: `internal.internal.testing.clearTestUser({ clerkId: string }) → { deleted: true, rows: number } | { deleted: false, reason: string }` — deletes every row owned by that user across ALL tables, then the users row. Refuses (no-op, `deleted: false`) unless the user's email contains `+clerk_test`. Callable from CLI as `bunx convex run internal/testing:clearTestUser '{"clerkId":"..."}'`.

- [ ] **Step 1: Write the failing tests**

Create `tests/testing-cleanup.test.ts`:

```ts
/// <reference types="vite/client" />
// Guarded test-data cleanup (Phase 2 E2E pre-clean). The guard is the point:
// this must be structurally unable to wipe a real account.
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);

const TEST_USER = {
  subject: 'clerk_e2e_a',
  name: 'E2E User',
  email: 'atlas.e2e+clerk_test@example.com',
};
const REAL_USER = { subject: 'clerk_real', name: 'Real Person', email: 'abeche88@gmail.com' };

async function seededWorld(identity: typeof TEST_USER) {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity(identity);
  await asUser.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const entryId = await asUser.mutation(api.entries.create, {
    kind: 'journal',
    body: 'seed',
    occurredAt: 1000,
  });
  const knowledgeId = await asUser.mutation(api.knowledge.create, {
    type: 'insight',
    statement: 'seed insight',
  });
  await asUser.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
  return { t, asUser };
}

describe('internal/testing.clearTestUser', () => {
  it('deletes every row for a +clerk_test user', async () => {
    const { t, asUser } = await seededWorld(TEST_USER);
    const result = await t.mutation(internal.internal.testing.clearTestUser, {
      clerkId: TEST_USER.subject,
    });
    expect(result.deleted).toBe(true);
    expect(await asUser.query(api.account.me, {})).toBeNull();
    // Re-provision proves entries/knowledge are gone, not just the users row.
    await asUser.mutation(api.account.ensureUser, { timezone: 'UTC' });
    expect(await asUser.query(api.entries.list, {})).toEqual([]);
    expect(await asUser.query(api.knowledge.list, {})).toEqual([]);
  });

  it('refuses to touch an account without +clerk_test in the email', async () => {
    const world = convexTest(schema, modules);
    const asReal = world.withIdentity(REAL_USER);
    await asReal.mutation(api.account.ensureUser, { timezone: 'UTC' });
    const result = await world.mutation(internal.internal.testing.clearTestUser, {
      clerkId: REAL_USER.subject,
    });
    expect(result.deleted).toBe(false);
    expect(await asReal.query(api.account.me, {})).not.toBeNull();
  });

  it('is a no-op for unknown clerkIds', async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(internal.internal.testing.clearTestUser, {
      clerkId: 'clerk_nobody',
    });
    expect(result.deleted).toBe(false);
  });
});
```

(Note: convex-test runs internal functions via the `internal` API object — identity is irrelevant, matching CLI admin invocation.)

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/testing-cleanup.test.ts`
Expected: FAIL — `internal.internal.testing` does not exist.

- [ ] **Step 3: Implement `convex/internal/testing.ts`**

```ts
// E2E pre-clean (docs/spec/11-testing-strategy.md §3: "pre-clean is idempotent by
// test-user id"). INTERNAL by design — never export a public wrapper; the guard
// below is the only thing standing between a bad test config and real data.
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

const OWNED_TABLES = [
  'entries',
  'knowledge',
  'evidence',
  'relationships',
  'experiments',
  'outcomes',
  'revisions',
  'proposals',
  'reviews',
  'apiKeys',
  'aiRuns',
  'issues',
] as const;

export const clearTestUser = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .unique();
    if (user === null) return { deleted: false as const, reason: 'no such user' };
    if (!user.email.includes('+clerk_test')) {
      return { deleted: false as const, reason: 'refusing: not a +clerk_test account' };
    }

    let rows = 0;
    for (const table of OWNED_TABLES) {
      // Every owned table's first index leads with userId (schema invariant), but index
      // names differ — a full scan filtered by userId is fine at test-data scale and
      // keeps this maintenance-free as tables evolve.
      const docs = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field('userId'), user._id))
        .collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
        rows += 1;
      }
    }
    // crashes.userId is optional — clear the test user's crash rows too.
    const crashes = await ctx.db
      .query('crashes')
      .filter((q) => q.eq(q.field('userId'), user._id))
      .collect();
    for (const crash of crashes) {
      await ctx.db.delete(crash._id);
      rows += 1;
    }
    await ctx.db.delete(user._id);
    return { deleted: true as const, rows };
  },
});
```

Run: `bunx convex codegen`

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: PASS (all suites; registry-completeness unaffected — no new public functions).

- [ ] **Step 5: Push to dev deployment + commit**

```bash
bunx convex dev --once
git add convex/internal/testing.ts tests/testing-cleanup.test.ts convex/_generated/api.d.ts
git commit -m "Phase 2: guarded internal clearTestUser mutation for E2E pre-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Playwright infrastructure

**Files:**
- Create: `playwright.config.ts`, `e2e/global.setup.ts`, `e2e/helpers.ts`
- Modify: `package.json` (devDeps + scripts), `.gitignore`

**Interfaces:**
- Produces for Tasks 4–6:
  - `TEST_USERS` — `{ signup: {email, firstName, lastName}, a: {...}, b: {...} }` with emails `atlas.e2e.signup+clerk_test@example.com`, `atlas.e2e.a+clerk_test@example.com`, `atlas.e2e.b+clerk_test@example.com`.
  - `ensureClerkUser(user) → Promise<string>` — Clerk Backend API: find by email, create if missing (with first/last name); returns clerkId.
  - `deleteClerkUserIfExists(email) → Promise<void>` — refuses non-`+clerk_test` emails.
  - `precleanConvex(clerkId) → void` — execs `bunx convex run internal/testing:clearTestUser`.
  - `signInAs(page, user) → Promise<void>` — `clerk.signIn({ page, emailAddress })` then waits for `nav-capture`.
  - Playwright projects: `setup` (runs `clerkSetup()`) → `chromium` (depends on setup). `baseURL` http://localhost:3000. Screenshots on failure.

- [ ] **Step 1: Install deps**

```bash
bun add -d @playwright/test @clerk/testing dotenv
bunx playwright install chromium
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@playwright/test';

loadEnv({ path: '.env.local' });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // suites share two fixed test identities; serial keeps pre-clean sane
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    { name: 'chromium', use: { browserName: 'chromium' }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true, // never restart a dev server the owner already has running
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: `e2e/global.setup.ts`**

```ts
import { clerkSetup } from '@clerk/testing/playwright';
import { test as setup } from '@playwright/test';

setup.describe.configure({ mode: 'serial' });

setup('global setup', async ({}) => {
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
});
```

- [ ] **Step 4: `e2e/helpers.ts`**

```ts
// E2E identities and Clerk/Convex plumbing. ALL test identities are +clerk_test
// (dev-instance test mode: OTP 424242, no real email). Both cleanup paths refuse
// anything else — that guard is load-bearing, keep it.
import { execFileSync } from 'node:child_process';
import { clerk } from '@clerk/testing/playwright';
import { expect, type Page } from '@playwright/test';

export type TestUser = { email: string; firstName: string; lastName: string };

export const TEST_USERS = {
  signup: { email: 'atlas.e2e.signup+clerk_test@example.com', firstName: 'Sign', lastName: 'Up' },
  a: { email: 'atlas.e2e.a+clerk_test@example.com', firstName: 'User', lastName: 'Aye' },
  b: { email: 'atlas.e2e.b+clerk_test@example.com', firstName: 'User', lastName: 'Bee' },
} satisfies Record<string, TestUser>;

const CLERK_API = 'https://api.clerk.com/v1';

function clerkHeaders() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error('CLERK_SECRET_KEY missing — load .env.local');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findClerkUser(email: string): Promise<{ id: string } | null> {
  const response = await fetch(
    `${CLERK_API}/users?email_address=${encodeURIComponent(email)}`,
    { headers: clerkHeaders() },
  );
  const users = (await response.json()) as Array<{ id: string }>;
  return users[0] ?? null;
}

/** Find-or-create a Clerk test user; returns clerkId. */
export async function ensureClerkUser(user: TestUser): Promise<string> {
  const existing = await findClerkUser(user.email);
  if (existing !== null) return existing.id;
  const response = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: clerkHeaders(),
    body: JSON.stringify({
      email_address: [user.email],
      first_name: user.firstName,
      last_name: user.lastName,
    }),
  });
  if (!response.ok) throw new Error(`Clerk user create failed: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

/** Delete a Clerk user (refuses non-test emails) and their Convex data. */
export async function deleteClerkUserIfExists(email: string): Promise<void> {
  if (!email.includes('+clerk_test')) throw new Error(`refusing to delete non-test user ${email}`);
  const existing = await findClerkUser(email);
  if (existing === null) return;
  precleanConvex(existing.id);
  await fetch(`${CLERK_API}/users/${existing.id}`, { method: 'DELETE', headers: clerkHeaders() });
}

/** Idempotent Convex pre-clean by clerkId (guarded server-side too). */
export function precleanConvex(clerkId: string): void {
  execFileSync(
    'bunx',
    ['convex', 'run', 'internal/testing:clearTestUser', JSON.stringify({ clerkId })],
    { stdio: 'pipe' },
  );
}

/** Token-based sign-in for an EXISTING user; lands provisioned on Capture. */
export async function signInAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto('/capture');
  await expect(page.getByTestId('capture-input')).toBeVisible({ timeout: 15_000 });
}
```

- [ ] **Step 5: Scripts + gitignore**

In `package.json` scripts add:

```json
    "test:e2e": "playwright test",
    "test:e2e:batch": "playwright test --grep @batch",
```

Append to `.gitignore`:

```
# Playwright
test-results/
playwright-report/
```

- [ ] **Step 6: Verify + commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: clean (Playwright files typecheck; no e2e specs exist yet, do not run `test:e2e`).

```bash
git add playwright.config.ts e2e package.json bun.lock .gitignore
git commit -m "Phase 2: Playwright infrastructure — Clerk testing tokens, guarded test users, pre-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: E2E — auth + onboarding suite

**Files:**
- Create: `e2e/auth.spec.ts`

**Interfaces:** consumes Task 3 helpers. The ONLY place Clerk-internal selectors are allowed (sign-up UI has no testids); keep them inside this file's `signUpThroughUi` helper.

- [ ] **Step 1: Write `e2e/auth.spec.ts`**

```ts
// AC-1.1 signup with display name; More account card; sign out. Tag: @batch
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, deleteClerkUserIfExists, ensureClerkUser, precleanConvex, signInAs } from './helpers';

test.describe('auth + onboarding @batch', () => {
  test('fresh signup requires a name and lands on the capture empty state (AC-1.1)', async ({
    page,
  }) => {
    await deleteClerkUserIfExists(TEST_USERS.signup.email); // must not exist yet
    await setupClerkTestingToken({ page });
    await signUpThroughUi(page, TEST_USERS.signup);
    // Landed inside the shell, provisioned, on Capture:
    await expect(page.getByTestId('capture-input')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Nothing captured yet', { exact: false })).toBeVisible();
    // Display name made it into the users row (More card reads api.account.me):
    await page.getByTestId('nav-more').click();
    await expect(page.getByTestId('account-name')).toHaveText('Sign Up');
  });

  test('sign out returns to the landing page', async ({ page }) => {
    const clerkId = await ensureClerkUser(TEST_USERS.a);
    precleanConvex(clerkId);
    await signInAs(page, TEST_USERS.a);
    await page.getByTestId('nav-more').click();
    await page.getByTestId('sign-out').click();
    await expect(page.getByTestId('open-app')).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * Drives Clerk's real <SignUp> component. Clerk internals expose no testids;
 * these are its stable input names. If Clerk's UI changes, fix it HERE only.
 */
async function signUpThroughUi(page: Page, user: (typeof TEST_USERS)['signup']) {
  await page.goto('/sign-up');
  await page.locator('input[name="emailAddress"]').fill(user.email);
  await page.locator('input[name="firstName"]').fill(user.firstName);
  await page.locator('input[name="lastName"]').fill(user.lastName);
  await page.locator('.cl-formButtonPrimary').click();
  // Email OTP step — dev-instance universal test code:
  await page.locator('input[name="code"]').first().fill('424242');
  // Some Clerk versions auto-submit a complete code; click if the button is still there.
  const continueButton = page.locator('.cl-formButtonPrimary');
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click().catch(() => {});
  }
}
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e -- auth.spec.ts`
Expected: 2 passed (needs the dev server running or startable, `.env.local` present, Task 2's mutation pushed to the dev deployment). If the Clerk sign-up selectors fail, fix them inside `signUpThroughUi` only, note the actual selectors in the report.

- [ ] **Step 3: Commit**

```bash
git add e2e/auth.spec.ts
git commit -m "Phase 2 E2E: signup with display name, account card, sign out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: E2E — capture loop + crash-path suite

**Files:**
- Create: `e2e/capture-loop.spec.ts`

**Interfaces:** consumes Task 3 helpers. Covers the manual walking-skeleton path (AC-2.1, AC-2.4, AC-4.1 slice) AND the paths the Phase 1 final review flagged as structurally untestable by unit tests: delete-entry-then-navigate, stale entry URL → error boundary, archive-when-cited notice.

- [ ] **Step 1: Write `e2e/capture-loop.spec.ts`**

```ts
// Manual capture loop end-to-end + crash paths from the Phase 1 final review. Tag: @batch
import { expect, test } from '@playwright/test';
import { TEST_USERS, ensureClerkUser, precleanConvex, signInAs } from './helpers';

test.describe('capture loop @batch', () => {
  test.beforeEach(async ({ page }) => {
    const clerkId = await ensureClerkUser(TEST_USERS.a);
    precleanConvex(clerkId);
    await signInAs(page, TEST_USERS.a);
  });

  test('entry → knowledge → evidence → provenance detail (the walking skeleton)', async ({
    page,
  }) => {
    // Capture (AC-2.1)
    await page.getByTestId('capture-input').fill('Backed down in the meeting after a bad night.');
    await page.getByTestId('capture-save').click();
    await expect(page.getByTestId('entry-row')).toHaveCount(1);

    // Create knowledge
    await page.getByTestId('nav-knowledge').click();
    await page.getByTestId('knowledge-new').click();
    await page.getByTestId('knowledge-type-insight').click();
    await page.getByTestId('knowledge-statement-input').fill('I avoid conflict when tired.');
    await page.getByTestId('knowledge-create').click();

    // Link evidence by hand
    await page.getByTestId('evidence-add').click();
    await page.getByTestId('evidence-add-entry').selectOption({ index: 1 });
    await page.getByTestId('evidence-add-stance-supports').click();
    await page.getByTestId('evidence-add-save').click();

    // Provenance detail (AC-4.1 slice): confidence math + evidence + history
    await expect(page.getByText('Tentative — 1 supporting, 0 contradicting')).toBeVisible();
    await expect(page.getByTestId('evidence-row-supports')).toBeVisible();
    await expect(page.getByText('Created', { exact: false })).toBeVisible();
    await expect(page.getByText('Confidence recomputed: hypothesis → tentative', { exact: false })).toBeVisible();

    // Entry detail shows the citation both ways
    await page.getByTestId('nav-capture').click();
    await page.getByTestId('entry-row').click();
    await expect(page.getByTestId('evidence-row-supports')).toBeVisible();
  });

  test('deleting an uncited entry navigates home without crashing (final-review race)', async ({
    page,
  }) => {
    await page.getByTestId('capture-input').fill('Disposable entry.');
    await page.getByTestId('capture-save').click();
    await page.getByTestId('entry-row').click();
    await page.getByTestId('entry-remove').click();
    await expect(page.getByTestId('capture-input')).toBeVisible();
    await expect(page.getByTestId('app-error')).not.toBeVisible();
  });

  test('deleting a cited entry archives with an honest explanation (AC-2.4)', async ({ page }) => {
    // Build entry + knowledge + evidence quickly through the UI
    await page.getByTestId('capture-input').fill('Cited entry.');
    await page.getByTestId('capture-save').click();
    await page.getByTestId('nav-knowledge').click();
    await page.getByTestId('knowledge-new').click();
    await page.getByTestId('knowledge-type-observation').click();
    await page.getByTestId('knowledge-statement-input').fill('Something noticed.');
    await page.getByTestId('knowledge-create').click();
    await page.getByTestId('evidence-add').click();
    await page.getByTestId('evidence-add-entry').selectOption({ index: 1 });
    await page.getByTestId('evidence-add-save').click();
    await expect(page.getByTestId('evidence-row-supports')).toBeVisible();

    await page.getByTestId('nav-capture').click();
    await page.getByTestId('entry-row').click();
    await page.getByTestId('entry-remove').click();
    await expect(page.getByText('archived instead of deleted', { exact: false })).toBeVisible();
  });

  test('a stale entry URL shows the error boundary, not a crash (final-review path)', async ({
    page,
  }) => {
    await page.getByTestId('capture-input').fill('Soon gone.');
    await page.getByTestId('capture-save').click();
    await page.getByTestId('entry-row').click();
    const staleUrl = page.url();
    await page.getByTestId('entry-remove').click();
    await expect(page.getByTestId('capture-input')).toBeVisible();
    await page.goto(staleUrl);
    await expect(page.getByTestId('app-error')).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e -- capture-loop.spec.ts`
Expected: 4 passed. Flake rules: fix by waiting on testid state (never `waitForTimeout`); if the evidence-picker `selectOption({ index: 1 })` is ambiguous when multiple entries exist, select by visible label text instead.

- [ ] **Step 3: Commit**

```bash
git add e2e/capture-loop.spec.ts
git commit -m "Phase 2 E2E: capture loop + delete-race, cited-archive, stale-URL crash paths

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E — cross-account isolation

**Files:**
- Create: `e2e/isolation.spec.ts`

**Interfaces:** consumes Task 3 helpers. This is the Phase 1 gate's "second signup sees nothing" check, automated (AC-1.2's UI face; the function-level suite already runs in Vitest).

- [ ] **Step 1: Write `e2e/isolation.spec.ts`**

```ts
// Second account sees empty everything while user A has data. Tag: @batch
import { expect, test } from '@playwright/test';
import { TEST_USERS, ensureClerkUser, precleanConvex, signInAs } from './helpers';

test.describe('cross-account isolation @batch', () => {
  test('user B sees empty capture and knowledge while A has data', async ({ browser }) => {
    // A creates data
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const clerkIdA = await ensureClerkUser(TEST_USERS.a);
    precleanConvex(clerkIdA);
    await signInAs(pageA, TEST_USERS.a);
    await pageA.getByTestId('capture-input').fill('A private thought.');
    await pageA.getByTestId('capture-save').click();
    await expect(pageA.getByTestId('entry-row')).toHaveCount(1);
    await contextA.close();

    // B, in a fresh context, sees nothing
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const clerkIdB = await ensureClerkUser(TEST_USERS.b);
    precleanConvex(clerkIdB);
    await signInAs(pageB, TEST_USERS.b);
    await expect(pageB.getByTestId('entry-row')).toHaveCount(0);
    await expect(pageB.getByText('Nothing captured yet', { exact: false })).toBeVisible();
    await pageB.getByTestId('nav-knowledge').click();
    await expect(pageB.getByTestId('knowledge-row')).toHaveCount(0);
    await expect(pageB.getByText('Knowledge appears here', { exact: false })).toBeVisible();
    await contextB.close();
  });
});
```

- [ ] **Step 2: Run the full E2E batch**

Run: `bun run test:e2e:batch`
Expected: all suites pass (auth 2, capture-loop 4, isolation 1).

- [ ] **Step 3: Commit**

```bash
git add e2e/isolation.spec.ts
git commit -m "Phase 2 E2E: cross-account isolation (second signup sees nothing)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: AI stub provider flag (groundwork for Phase 3)

**Files:**
- Create: `convex/ai/provider.ts`
- Test: `tests/ai-provider.test.ts`

**Interfaces:**
- Produces: `getProviderKind(env) → 'stub' | 'live'` (pure: takes `env: Record<string, string | undefined>`, returns `'stub'` when `env.AI_PROVIDER === 'stub'`, else `'live'`); `stubDistillation(entryBody: string) → { ops: unknown[]; rationale: string }` — canned single-`createKnowledge` proposal whose ops MUST pass `validateOps` (that contract is the test). Phase 3's `ai/distill` action will route through this flag; nothing else is built now (YAGNI — the roadmap mandates the flag, not the pipeline).

- [ ] **Step 1: Write the failing test**

Create `tests/ai-provider.test.ts`:

```ts
// The stub provider's output must satisfy the proposal-op contract — E2E in Phase 3
// tests the loop, not the model (docs/spec/11-testing-strategy.md §3).
import { describe, expect, it } from 'vitest';
import { getProviderKind, stubDistillation } from '../convex/ai/provider';
import { validateOps } from '../convex/shared/proposalOps';

describe('ai provider flag', () => {
  it('selects stub only when AI_PROVIDER=stub', () => {
    expect(getProviderKind({ AI_PROVIDER: 'stub' })).toBe('stub');
    expect(getProviderKind({ AI_PROVIDER: 'live' })).toBe('live');
    expect(getProviderKind({})).toBe('live');
  });

  it('stub distillation output passes the op validator', () => {
    const result = stubDistillation('I noticed I interrupt people when nervous.');
    const verdicts = validateOps(result.ops);
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => v.valid)).toBe(true);
    expect(result.rationale.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/ai-provider.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `convex/ai/provider.ts`**

```ts
// AI provider selection (docs/spec/11-testing-strategy.md §3): a dev-only env flag
// routes ai/* actions to a fixture provider so E2E tests the loop, not the model.
// Phase 3's distill/connect actions consume this; only the flag + one fixture exist now.

export function getProviderKind(env: Record<string, string | undefined>): 'stub' | 'live' {
  return env.AI_PROVIDER === 'stub' ? 'stub' : 'live';
}

/** Canned distillation: one conservative observation with the entry as evidence-to-be. */
export function stubDistillation(entryBody: string): { ops: unknown[]; rationale: string } {
  const excerpt = entryBody.slice(0, 80);
  return {
    ops: [
      {
        op: 'createKnowledge',
        type: 'observation',
        statement: `I noticed: ${excerpt}`.slice(0, 280),
      },
    ],
    rationale: 'Stub provider: one conservative observation from the entry opening.',
  };
}
```

Run: `bunx convex codegen`

- [ ] **Step 4: Run tests + commit**

Run: `bun run test`
Expected: PASS (no new public functions; registry unaffected).

```bash
git add convex/ai/provider.ts tests/ai-provider.test.ts convex/_generated/api.d.ts
git commit -m "Phase 2: AI stub provider flag + fixture (contract-tested against validateOps)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** spec 11 §6: "CI: typecheck + lint + unit + convex-test on every push; E2E nightly + pre-release" — E2E stays out of CI for now (needs dev-deployment secrets); this lands the push gate.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Phase 2: CI — typecheck + lint + invariants + unit/convex-test on push

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Verification happens on the PR itself — the workflow must go green there before merge.)

---

### Task 9: Ship — full gate, PR, ledger

- [ ] **Step 1: Full local gate**

```bash
bun run pipeline
bun run test:e2e:batch
```

Expected: pipeline green; 7 E2E tests green.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin phase-2-verification-harness
gh pr create --title "Phase 2: verification harness — Playwright E2E, guarded pre-clean, AI stub flag, CI" --body "$(cat <<'EOF'
Playwright infrastructure against the real dev stack: Clerk testing tokens, +clerk_test identities (OTP 424242), guarded pre-clean (internal Convex mutation that refuses non-test accounts), testid-only selectors.

Suites (@batch): signup-with-display-name + account card + sign-out; the manual capture loop end-to-end (entry → knowledge → evidence → provenance detail); the Phase 1 final-review crash paths (delete-entry race, cited-entry archive notice, stale-URL error boundary); cross-account isolation (second account sees nothing).

Also: AI stub provider flag (fixture contract-tested against validateOps, ready for Phase 3), CI (typecheck+lint+unit+convex-test on push), and two spec corrections from Phase 1 findings (03 §5 confidence precedence, 09 §2 Convex-integration name-claim deviation).

Phase 2 gate: the full pipeline including tagged E2E is the only way anything ships from here on.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI green on the PR, merge, sync, ledger**

```bash
gh pr checks --watch
# after merge:
git checkout main && git pull
echo "$(date +%F) Phase 2 verification harness shipped: Playwright E2E (auth/capture-loop/crash-paths/isolation, 7 tests), guarded clearTestUser pre-clean, AI stub flag, CI on push; spec 03/09 corrections — Phase 2 gate active: pipeline + tagged E2E is the only ship path" >> LEDGER.md
```

(No Vercel-visible runtime changes; `bunx convex dev --once` already pushed the internal mutation in Task 2. No prod deploy needed.)

---

## Deferred (deliberately)

- E2E in CI (needs dev-deployment + Clerk secrets in GitHub; spec says nightly + pre-release — set up when the cadence hurts).
- Experiment-loop, search-ask, settings E2E suites — their features don't exist yet (Phases 3–5 add suites with the features).
- `@live-ai` tagged smoke — Phase 3 (no AI actions exist).
- Draft-persistence unit extraction ("pure libs extracted where logic crept into components") — the only component logic today is capture's draft handling; extract when Phase 3 touches capture again rather than churning a just-stabilized file now.
