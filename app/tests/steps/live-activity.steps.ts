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

When('I enter Live Activity fullscreen', async ({ page }) => {
  const trigger = page.getByTestId('live-activity-fullscreen-btn');
  await expect(trigger).toBeVisible({ timeout: testConfig.timeouts.element });
  await trigger.click();
});

When('I exit Live Activity fullscreen', async ({ page }) => {
  await page.getByTestId('live-activity-exit-fullscreen-btn').click();
});

Then('the Live Activity page chrome should be hidden', async ({ page }) => {
  await expect(page.getByTestId('live-activity-fullscreen')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
  await expect(page.getByTestId('live-activity-settings-btn')).toBeHidden();
  await expect(page.getByTestId('live-activity-fullscreen-btn')).toBeHidden();
});

Then('the Live Activity page chrome should be visible', async ({ page }) => {
  await expect(page.getByTestId('live-activity-settings-btn')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
  await expect(page.getByTestId('live-activity-fullscreen')).toBeHidden();
});

Then('the Live Activity page should still be fullscreen', async ({ page }) => {
  await expect(page.getByTestId('live-activity-fullscreen')).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
});

// The two pages used to be one setting away from sharing a fullscreen state,
// so this asserts Montage is where it was left rather than dragged along.
Then('the Montage page should not be fullscreen', async ({ page }) => {
  await page.getByTestId('nav-item-montage').click();
  await expect(page.getByTestId('montage-fullscreen-button')).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
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

// Recording mode does not decide what this page watches (#313): a continuously
// recording camera reports idle until motion, so it belongs here like any
// other. These two steps together fail if any monitor is excluded without the
// user asking, because the count and the switches would disagree with the list.
Then('every listed monitor should be switched on', async ({ page }) => {
  const switches = page.getByTestId(/^live-activity-ignore-/);
  const count = await switches.count();
  expect(count, 'expected the settings dialog to list at least one monitor').toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    await expect(switches.nth(i)).toHaveAttribute('data-state', 'checked');
  }
});

Then('the number of listed monitors should match the watched count', async ({ page }) => {
  const listed = await page.getByTestId(/^live-activity-ignore-/).count();
  await page.getByTestId('dialog-close-button').click();
  const text = await page.getByTestId('live-activity-empty').innerText();
  const match = text.match(/Watching (\d+) monitors?/i);
  expect(match, `expected a "Watching N monitor(s)" count in: ${text}`).not.toBeNull();
  expect(Number(match![1])).toBe(listed);
});
