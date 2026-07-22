// Connections screen: API key create → show-once plaintext → list-by-prefix →
// revoke → struck/gone (Phase M Task 6). OAuth dance is not E2E'd — the
// contract suite covers it (tests/mcp-contract.test.ts). Tag: @batch
import { expect, test } from '@playwright/test';
import { TEST_USERS, ensureClerkUser, precleanConvex, signInAs } from './helpers';

test.describe('connections @batch', () => {
  test.beforeEach(async ({ page }) => {
    const clerkId = await ensureClerkUser(TEST_USERS.a);
    precleanConvex(clerkId);
    await signInAs(page, TEST_USERS.a);
  });

  test('create key → plaintext shown once → listed by prefix → revoke → struck/gone', async ({
    page,
  }) => {
    await page.goto('/connections');

    // Create
    await page.getByTestId('key-name-input').fill('Codex CLI');
    await page.getByTestId('key-create').click();

    // Plaintext shown exactly once, with the atlas_sk_ prefix
    const plaintextBlock = page.getByTestId('key-plaintext');
    await expect(plaintextBlock).toBeVisible();
    const plaintext = (await page.getByTestId('key-plaintext').locator('pre').textContent())?.trim();
    expect(plaintext).toMatch(/^atlas_sk_/);
    const prefix = plaintext!.slice(0, 12);

    // Dismiss — plaintext disappears and doesn't come back after reload
    await page.getByTestId('key-plaintext-done').click();
    await expect(plaintextBlock).not.toBeVisible();
    await page.reload();
    await expect(page.getByTestId('key-plaintext')).not.toBeVisible();

    // Listed by prefix (never the plaintext again)
    await expect(page.getByText(prefix, { exact: false })).toBeVisible();
    await expect(page.getByText('Codex CLI', { exact: true })).toBeVisible();

    // Revoke: click, confirm, then struck/dimmed with no more revoke control
    await page.getByTestId('key-revoke-0').click();
    await page.getByTestId('key-revoke-0-confirm').click();
    await expect(page.getByText('Codex CLI', { exact: true })).toHaveClass(/line-through/);
    await expect(page.getByTestId('key-revoke-0')).not.toBeVisible();
  });
});
