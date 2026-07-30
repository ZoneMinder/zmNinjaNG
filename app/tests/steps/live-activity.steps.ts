import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

When('I open the Live Activity settings', async ({ page }) => {
  const trigger = page.getByTestId('live-activity-settings-btn');
  await expect(trigger).toBeVisible({ timeout: testConfig.timeouts.element });
  await trigger.click();
  await expect(page.getByTestId('live-activity-settings-dialog')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

When('I set the dwell window to {int} seconds', async ({ page }, seconds: number) => {
  const dwellInput = page.getByTestId('live-activity-dwell-input');
  await dwellInput.fill(String(seconds));
  // The field commits on blur, not on every keystroke (see
  // LiveActivitySettingsDialog's useClampedNumberField), so the value is not
  // written to the profile store until focus leaves the input.
  await dwellInput.blur();
});

When('I close the Live Activity settings', async ({ page }) => {
  await page.getByTestId('dialog-close-button').click();
  await expect(page.getByTestId('live-activity-settings-dialog')).toBeHidden({
    timeout: testConfig.timeouts.element,
  });
});

Then('the dwell window should be {int} seconds', async ({ page }, seconds: number) => {
  await expect(page.getByTestId('live-activity-dwell-input')).toHaveValue(String(seconds), {
    timeout: testConfig.timeouts.element,
  });
});

Then('I should see the all-quiet message', async ({ page }) => {
  await expect(page.getByTestId('live-activity-empty')).toContainText(/all quiet/i, {
    timeout: testConfig.timeouts.pageLoad,
  });
});

// Content assertion, not a presence check: this fails if the watched-monitor
// count interpolation breaks (e.g. renders the literal "{{count}}" or a
// non-positive value) even though the empty-state element itself still
// renders fine.
Then('the all-quiet message should name how many monitors are being watched', async ({ page }) => {
  const text = await page.getByTestId('live-activity-empty').innerText();
  // "monitors?" because the string is a plural family: a server with exactly
  // one watched monitor renders "Watching 1 monitor".
  const match = text.match(/Watching (\d+) monitors?/i);
  expect(match, `expected a "Watching N monitor(s)" count in: ${text}`).not.toBeNull();
  expect(Number(match![1])).toBeGreaterThan(0);
});
