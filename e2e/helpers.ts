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
    [
      'convex',
      'run',
      'internal/testing:clearTestUser',
      JSON.stringify({ clerkId, allowEmptyEmail: true }),
    ],
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
