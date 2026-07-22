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
  // Email OTP step — dev-instance universal test code. Clerk renders this as a
  // 6-segment `input-otp` widget with one visually-hidden input carrying the
  // real value (aria-label "Enter verification code", no stable name/id).
  // `.fill()` sets the value without firing the per-keystroke events the
  // widget's internal state machine expects, so it never registers a
  // complete code and the following verify request 400s. Focus it and type
  // instead, which drives real keydown/input events per digit.
  const otp = page.getByRole('textbox', { name: 'Enter verification code' });
  await otp.waitFor({ state: 'visible' });
  await otp.click();
  await page.keyboard.type('424242', { delay: 50 });
}
