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
    await expect(
      page.getByText('Confidence recomputed: hypothesis → tentative', { exact: false }),
    ).toBeVisible();

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
    // Client-side nav is async — wait for the detail-page-only testid before
    // trusting page.url(), otherwise this races and captures '/capture'.
    await expect(page.getByTestId('entry-remove')).toBeVisible();
    const staleUrl = page.url();
    await page.getByTestId('entry-remove').click();
    await expect(page.getByTestId('capture-input')).toBeVisible();
    await page.goto(staleUrl);
    await expect(page.getByTestId('app-error')).toBeVisible({ timeout: 15_000 });
  });
});
