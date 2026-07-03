import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// Count of delete buttons captured just before a single delete, so the
// follow-up assertion can check it went down by exactly one.
let countBeforeDelete = 0;

Given('I am on the developer notices page', async ({ page }) => {
  // The next step waits for the list; here we only need the navigation to land.
  await page.goto('/#/developer-notice', { waitUntil: 'domcontentloaded' });
});

Given('the notice list has at least one notice', async ({ page }) => {
  const list = page.getByTestId('developer-notice-list');
  await expect(list).toBeVisible();
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  await expect(deletes.first()).toBeVisible();
});

When('I delete the first notice', async ({ page }) => {
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  countBeforeDelete = await deletes.count();
  await deletes.first().click();
});

Then('the notice count should decrease by one', async ({ page }) => {
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  await expect(deletes).toHaveCount(countBeforeDelete - 1);
});

When('I clear all notices', async ({ page }) => {
  await page.getByTestId('developer-notice-actions-menu').click();
  await page.getByTestId('developer-notice-clear-all').click();
  await page.getByTestId('developer-notice-clear-all-confirm').click();
});

Then('the notice list should be empty', async ({ page }) => {
  await expect(page.getByTestId('developer-notice-list')).toHaveCount(0);
});

When('I restore deleted notices', async ({ page }) => {
  const emptyRestore = page.getByTestId('developer-notice-restore-deleted-empty');
  if (await emptyRestore.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emptyRestore.click();
    return;
  }
  await page.getByTestId('developer-notice-actions-menu').click();
  await page.getByTestId('developer-notice-restore-deleted').click();
});

Then('the notice list should not be empty', async ({ page }) => {
  await expect(page.getByTestId('developer-notice-list')).toBeVisible();
  await expect(page.locator('[data-testid^="developer-notice-delete-"]').first()).toBeVisible();
});
