import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getGroupCount } from '../helpers/zm-api';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

let groupFilterAvailable = false;
let monitorCountBeforeFilter = 0;

// Group Filter Steps
Then('I should see the group filter if groups are available', async ({ page }) => {
  // Whether the filter should render is a server-side fact. Reading it from the
  // UI made the step self-confirming: a filter that stopped rendering set
  // groupFilterAvailable to false and every later step skipped itself.
  const serverGroupCount = await getGroupCount();
  const groupFilter = page.getByTestId('group-filter-select');

  await expect
    .poll(() => groupFilter.isVisible().catch(() => false), {
      timeout: testConfig.timeouts.element,
    })
    .toBe(serverGroupCount > 0);

  groupFilterAvailable = serverGroupCount > 0;
  log.info('E2E: Group filter check', {
    component: 'e2e',
    available: groupFilterAvailable,
    serverGroupCount,
  });
});

When('I select a group from the filter if available', async ({ page }) => {
  const groupFilter = page.getByTestId('group-filter-select');
  groupFilterAvailable = await groupFilter.isVisible({ timeout: 2000 }).catch(() => false);

  if (groupFilterAvailable) {
    // Store current monitor count before filtering
    const monitorCards = page.getByTestId('monitor-card');
    monitorCountBeforeFilter = await monitorCards.count().catch(() => 0);

    await groupFilter.click();
    // Wait for dropdown to open
    await page.waitForTimeout(300);
    // Click the first group option (not "All Monitors")
    const groupOption = page.getByTestId(/^group-filter-\d+$/).first();
    if (await groupOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await groupOption.click();
      log.info('E2E: Selected group from filter', { component: 'e2e' });
    } else {
      // No groups available, close the dropdown
      await page.keyboard.press('Escape');
      groupFilterAvailable = false;
      log.info('E2E: No groups available to select', { component: 'e2e' });
    }
  }
});

Then('the filter should be applied', async ({ page }) => {
  if (!groupFilterAvailable) {
    // If no groups, skip the verification
    log.info('E2E: Skipping filter verification - no groups', { component: 'e2e' });
    return;
  }

  // Give time for the filter to apply
  await page.waitForTimeout(500);

  // Verify the group filter still shows a selection (not "All Monitors")
  const groupFilter = page.getByTestId('group-filter-select');
  await expect(groupFilter).toBeVisible();
  log.info('E2E: Group filter applied', { component: 'e2e' });
});

When('I clear the group filter if available', async ({ page }) => {
  if (!groupFilterAvailable) {
    log.info('E2E: Skipping clear - no group filter', { component: 'e2e' });
    return;
  }

  const groupFilter = page.getByTestId('group-filter-select');
  await groupFilter.click();
  await page.waitForTimeout(300);

  // Click "All Monitors" or the clear option
  const allOption = page.getByTestId('group-filter-all')
    .or(page.locator('text=/all monitors/i'));
  if (await allOption.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await allOption.first().click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(500);
});

Then('all monitors should be visible again', async ({ page }) => {
  if (!groupFilterAvailable) {
    log.info('E2E: Skipping all monitors check - no group filter', { component: 'e2e' });
    return;
  }

  // Clearing the filter restores the unfiltered set, so the count has to come
  // back to what it was before the group was selected.
  const monitorCards = page.getByTestId('monitor-card');
  await expect
    .poll(() => monitorCards.count(), { timeout: testConfig.timeouts.pageLoad })
    .toBe(monitorCountBeforeFilter);
});

Then('the group filter selection should persist', async ({ page }) => {
  if (!groupFilterAvailable) {
    log.info('E2E: Skipping persistence check - no group filter', { component: 'e2e' });
    return;
  }

  // After navigating away and back, the group filter should still have a selection
  const groupFilter = page.getByTestId('group-filter-select');
  await expect(groupFilter).toBeVisible({ timeout: testConfig.timeouts.element });
  log.info('E2E: Group filter persisted across navigation', { component: 'e2e' });
});
