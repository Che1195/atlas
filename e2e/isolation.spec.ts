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
