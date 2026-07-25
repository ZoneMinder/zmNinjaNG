import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Monitor Recent Events (refs #213)
// The scenario's own "Given I am logged into zmNinjaNg" navigates back to "/",
// undoing the Background's monitor-detail navigation, so this step always
// navigates to Monitors and clicks into the first monitor rather than
// assuming Background already put us there.
When("I open the first monitor's detail view", async ({ page }) => {
  if (!/\/monitors\/\d+/.test(page.url())) {
    const mobileMenuButton = page.getByTestId('mobile-menu-button');
    if (await mobileMenuButton.isVisible().catch(() => false)) {
      await mobileMenuButton.click();
    }
    const navItem = page.locator('[data-testid="nav-item-monitors"]').locator('visible=true').first();
    // Wait for the (possibly still-animating) mobile menu to reveal the nav
    // item rather than sleeping a fixed duration; click() would auto-wait too,
    // but making the wait explicit documents what it is for.
    await navItem.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
    await navItem.click();
    await page.waitForURL(/.*monitors$/, { timeout: testConfig.timeouts.transition });

    const monitorPlayer = page.getByTestId('monitor-player').first();
    await expect(monitorPlayer).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
    await monitorPlayer.click();
    await page.waitForURL(/.*monitors\/\d+/, { timeout: testConfig.timeouts.transition });
  }
});

Then('the recent events list should be visible', async ({ page }) => {
  await expect(page.getByTestId('monitor-recent-events')).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
});

When('I tap the recent events collapse toggle', async ({ page }) => {
  await page.getByTestId('monitor-recent-events-toggle').click();
  // No fixed wait here: every scenario using this step follows immediately
  // with a "Then ... body should be hidden/visible" assertion that polls for
  // the resulting state (see below), so an extra sleep here is redundant.
});

Then('the recent events body should be hidden', async ({ page }) => {
  await expect(page.getByTestId('monitor-recent-events-body')).toBeHidden({
    timeout: testConfig.timeouts.transition,
  });
});

Then('the recent events body should still be hidden', async ({ page }) => {
  await expect(page.getByTestId('monitor-recent-events-body')).toBeHidden({
    timeout: testConfig.timeouts.transition,
  });
});

Then('the recent events body should be visible', async ({ page }) => {
  await expect(page.getByTestId('monitor-recent-events-body')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

// Generic tap-by-label step; matches any visible button by its accessible name.
When('I tap {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: label }).first().click();
});

Then('I should be on the events page filtered to that monitor', async ({ page }) => {
  await expect(page).toHaveURL(/\/events\?monitorId=\d+/, {
    timeout: testConfig.timeouts.transition,
  });
});

// Bulk delete batch bar (cancel path only, refs #213). This must never click
// delete-batch-confirm: the events on the live ZM server are real and
// deletion is permanent.
When('I queue the first two recent events for deletion', async ({ page }) => {
  const rows = page.locator('[data-testid="monitor-recent-events-body"] [data-testid="compact-event-row"]');
  await expect(rows.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  const count = await rows.count();
  for (let i = 0; i < Math.min(2, count); i++) {
    await rows.nth(i).getByTestId('event-delete-button').click();
  }
});

Then('the delete batch bar should show {int} events', async ({ page }, count: number) => {
  const bar = page.getByTestId('delete-batch-bar');
  await expect(bar).toBeVisible({ timeout: testConfig.timeouts.transition });
  await expect(bar).toContainText(String(count));
});

When('I cancel the delete batch', async ({ page }) => {
  await page.getByTestId('delete-batch-cancel').click();
});

Then('the delete batch bar should be gone', async ({ page }) => {
  await expect(page.getByTestId('delete-batch-bar')).not.toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

// Shared <main> scroll restoration on monitor detail (refs #196)
let mainScrollBefore = 0;

function readMainScrollTop(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-tv-region="main"]') as HTMLElement | null;
    return el ? el.scrollTop : 0;
  });
}

When('I scroll the main container down', async ({ page }) => {
  // Let the recent-events list finish loading so the page has enough content to overflow.
  await expect(page.getByTestId('monitor-recent-events-body')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
  await page.evaluate(() => {
    const el = document.querySelector('[data-tv-region="main"]') as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  });
  expect(await readMainScrollTop(page)).toBeGreaterThan(0);
});

When('I click the first recent event row', async ({ page }) => {
  const firstRow = page.locator('[data-testid="compact-event-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: testConfig.timeouts.transition });

  // Scrolled to the bottom, the list's first row sits above the viewport, so
  // click() would scroll it into view first. Do that explicitly and record the
  // position afterwards: the offset the app has to restore is the one at the
  // moment of navigation, not the one before the row came into view. Recording
  // before the scroll made this assert a delta the app never had a chance to
  // produce (refs #237).
  await firstRow.scrollIntoViewIfNeeded();
  mainScrollBefore = await readMainScrollTop(page);
  log.info('E2E: main container scrolled before opening event', { component: 'e2e', mainScrollBefore });
  expect(mainScrollBefore).toBeGreaterThan(0);

  await firstRow.click();
  await page.waitForURL(/\/events\/\d+/, { timeout: testConfig.timeouts.transition });
});

When('I go back', async ({ page }) => {
  await page.goBack();
  await page.waitForURL(/\/monitors\/\d+/, { timeout: testConfig.timeouts.transition });
});

Then('the main container scroll position should be restored', async ({ page }) => {
  await expect.poll(() => readMainScrollTop(page), { timeout: 2000 }).toBeGreaterThan(0);

  const after = await readMainScrollTop(page);
  log.info('E2E: main container scroll after back navigation', {
    component: 'e2e',
    mainScrollBefore,
    after,
  });
  expect(after).toBeGreaterThan(0);
  expect(Math.abs(after - mainScrollBefore)).toBeLessThanOrEqual(40);
});

// Return highlight indicator (refs #213)
When('I open the first recent event', async ({ page }) => {
  const firstRow = page.locator('[data-testid="monitor-recent-events-body"] [data-testid="compact-event-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: testConfig.timeouts.transition });
  await firstRow.click();
  await page.waitForURL(/\/events\//, { timeout: testConfig.timeouts.transition });
});

Then('the returned-from recent event should be flagged', async ({ page }) => {
  await expect(page.getByTestId('monitor-recent-events-body')).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
  await expect(page.getByTestId('return-flash-indicator')).toBeVisible();
});
