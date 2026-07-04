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
  // Radix Select sets aria-expanded on the trigger; wait for the popover to
  // actually open instead of guessing how long the animation takes.
  await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: testConfig.timeouts.element });
  const options = page.getByTestId(/^group-filter-\d+$/);
  // Give the (possibly empty) option list a chance to render before counting.
  await options.first().waitFor({ state: 'visible', timeout: testConfig.timeouts.element }).catch(() => {});
  const count = await options.count().catch(() => 0);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const tid = await options.nth(i).getAttribute('data-testid');
    if (tid) ids.push(tid);
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: testConfig.timeouts.element });
  return ids;
}

async function selectGroup(page: Page, optionTestId: string) {
  const trigger = page.getByTestId('group-filter-select');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: testConfig.timeouts.element });
  await page.getByTestId(optionTestId).click();
  // Radix closes the popover and re-renders the trigger's displayed value on
  // selection; wait for that state change instead of a fixed sleep.
  await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: testConfig.timeouts.element });
}

async function applyColumns(page: Page, cols: number) {
  const trigger = page.getByTestId('montage-layout-trigger');
  await trigger.click();
  const preset = page.getByTestId(`montage-grid-preset-${cols}`);
  await expect(preset).toBeVisible({ timeout: testConfig.timeouts.element });
  await preset.click();
  // The trigger carries a live data-grid-cols attribute; wait for the applied
  // value rather than assuming the re-render finished within a fixed delay.
  await expect(trigger).toHaveAttribute('data-grid-cols', String(cols), {
    timeout: testConfig.timeouts.element,
  });
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
