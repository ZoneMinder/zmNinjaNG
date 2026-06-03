import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

let twoGroupsAvailable = false;
let groupAId: string | null = null;
let groupBId: string | null = null;

async function listGroupOptionIds(page: Page): Promise<string[]> {
  const trigger = page.getByTestId('group-filter-select');
  if (!(await trigger.isVisible({ timeout: 2000 }).catch(() => false))) return [];
  await trigger.click();
  await page.waitForTimeout(300);
  const options = page.getByTestId(/^group-filter-\d+$/);
  const count = await options.count().catch(() => 0);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const tid = await options.nth(i).getAttribute('data-testid');
    if (tid) ids.push(tid);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return ids;
}

async function selectGroup(page: Page, optionTestId: string) {
  await page.getByTestId('group-filter-select').click();
  await page.waitForTimeout(300);
  await page.getByTestId(optionTestId).click();
  await page.waitForTimeout(400);
}

async function applyColumns(page: Page, cols: number) {
  await page.getByTestId('montage-layout-trigger').click();
  await page.waitForTimeout(200);
  await page.getByTestId(`montage-grid-preset-${cols}`).click();
  await page.waitForTimeout(400);
}

When('I record whether two montage groups are selectable', async ({ page }) => {
  const ids = await listGroupOptionIds(page);
  twoGroupsAvailable = ids.length >= 2;
  if (twoGroupsAvailable) {
    groupAId = ids[0];
    groupBId = ids[1];
  }
  log.info('E2E: two montage groups available', {
    component: 'e2e',
    twoGroupsAvailable,
    count: ids.length,
  });
});

When('I select montage group A and apply 2 columns', async ({ page }) => {
  if (!twoGroupsAvailable || !groupAId) return;
  await selectGroup(page, groupAId);
  await applyColumns(page, 2);
});

When('I select montage group B and apply 3 columns', async ({ page }) => {
  if (!twoGroupsAvailable || !groupBId) return;
  await selectGroup(page, groupBId);
  await applyColumns(page, 3);
});

When('I re-select montage group A', async ({ page }) => {
  if (!twoGroupsAvailable || !groupAId) return;
  await selectGroup(page, groupAId);
});

Then('the montage layout should show 2 columns for group A', async ({ page }) => {
  if (!twoGroupsAvailable) {
    log.info('E2E: skipping group-arrangement assertion, fewer than two groups', {
      component: 'e2e',
    });
    return;
  }
  const trigger = page.getByTestId('montage-layout-trigger');
  await expect(trigger).toHaveAttribute('data-grid-cols', '2', {
    timeout: testConfig.timeouts.element,
  });
});
