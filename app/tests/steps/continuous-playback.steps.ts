import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

// The event detail URL is /events/<numeric id>. This is the guard for the
// gated steps below: it is derived from navigation, not from the toggle under
// test, so a regression in the toggle cannot turn its own scenario green
// (rule 34). When a detail page is present, the steps hard-assert.
function onEventDetail(page: import('@playwright/test').Page): boolean {
  return /\/events\/\d+/.test(page.url());
}

const toggle = (page: import('@playwright/test').Page) =>
  page.getByTestId('event-detail-continuous-play');

Then('the continuous-play toggle is visible if on an event detail page', async ({ page }) => {
  if (!onEventDetail(page)) return; // no events on this server: not applicable
  await expect(toggle(page)).toBeVisible();
});

When('I enable continuous play if on an event detail page', async ({ page }) => {
  if (!onEventDetail(page)) return;
  const btn = toggle(page);
  await expect(btn).toBeVisible();
  if ((await btn.getAttribute('aria-pressed')) !== 'true') {
    await btn.click();
  }
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
});

Then('continuous play is still enabled if on an event detail page', async ({ page }) => {
  if (!onEventDetail(page)) return;
  // After the reload the toggle reflects the persisted profile setting.
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true', {
    timeout: testConfig.timeouts.transition,
  });
});
