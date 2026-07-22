// Phase 3a Task 8: the AI loop against the stub provider (AC-3.1/3.2). The stub
// proposes exactly one createKnowledge op ('I noticed: <first 80 chars>...') with
// one citation — enough to exercise distill → review → approve/reject → knowledge
// without depending on a live model. Tag: @batch
import { expect, test } from '@playwright/test';
import { TEST_USERS, ensureClerkUser, precleanConvex, signInAs } from './helpers';

const ENTRY_BODY =
  'Noticed I get defensive whenever someone questions my plans in front of the team, ' +
  'even when the question is reasonable and offered in good faith.';

test.describe('AI loop (stub provider) @batch', () => {
  test.beforeEach(async ({ page }) => {
    const clerkId = await ensureClerkUser(TEST_USERS.a);
    precleanConvex(clerkId);
    await signInAs(page, TEST_USERS.a);
  });

  test('distill → review → approve remaining → apply → knowledge with provenance (AC-3.1/3.2)', async ({
    page,
  }) => {
    // Capture
    await page.getByTestId('capture-input').fill(ENTRY_BODY);
    await page.getByTestId('capture-save').click();
    await expect(page.getByTestId('entry-row')).toHaveCount(1);

    // Open entry, trigger distill
    await page.getByTestId('entry-row').click();
    await page.getByTestId('entry-distill').click();
    await expect(page.getByTestId('entry-distill')).toHaveText('Distilled ✓ — view proposal', {
      timeout: 20_000,
    });

    // Nav shows one pending review
    await expect(page.getByTestId('nav-review-count')).toHaveText(' · 1');

    // Review page shows the stub's op card
    await page.getByTestId('nav-review').click();
    await expect(page.getByTestId('review-proposal')).toBeVisible();
    await expect(page.getByTestId('op-approve-0')).toBeVisible();
    await expect(page.getByText('I noticed:', { exact: false })).toBeVisible();

    // Approve remaining, apply
    await page.getByTestId('proposal-approve-remaining').click();
    await page.getByTestId('proposal-apply').click();
    await expect(page.getByTestId('review-empty')).toBeVisible();
    await expect(page.getByTestId('nav-review-count')).not.toBeVisible();

    // Knowledge list contains the stub statement
    await page.getByTestId('nav-knowledge').click();
    await expect(page.getByTestId('knowledge-row')).toHaveCount(1);
    await expect(page.getByText('I noticed:', { exact: false })).toBeVisible();

    // Detail history shows AI provenance
    await page.getByTestId('knowledge-row').click();
    await expect(page.getByText('AI-proposed, you approved', { exact: false })).toBeVisible();
  });

  test('reject leaves no trace: queue empties, knowledge stays empty', async ({ page }) => {
    await page.getByTestId('capture-input').fill(ENTRY_BODY);
    await page.getByTestId('capture-save').click();
    await page.getByTestId('entry-row').click();
    await page.getByTestId('entry-distill').click();
    await expect(page.getByTestId('entry-distill')).toHaveText('Distilled ✓ — view proposal', {
      timeout: 20_000,
    });

    await page.getByTestId('nav-review').click();
    await page.getByTestId('op-reject-0').click();
    await page.getByTestId('proposal-apply').click();
    await expect(page.getByTestId('review-empty')).toBeVisible();

    await page.getByTestId('nav-knowledge').click();
    await expect(page.getByTestId('knowledge-row')).toHaveCount(0);
    await expect(page.getByText('Knowledge appears here', { exact: false })).toBeVisible();
  });
});
