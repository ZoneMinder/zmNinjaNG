import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

When('I enable TV mode in settings', async ({ page }) => {
  await page.getByTestId('nav-item-settings').first().click();
  await page.waitForURL(/#\/settings$/, { timeout: testConfig.timeouts.transition });

  const toggle = page.getByTestId('settings-tv-mode');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.element });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  // Outcome, not just the click: the setting persisted to the store.
  await expect(toggle).toHaveAttribute('aria-checked', 'true', {
    timeout: testConfig.timeouts.transition,
  });
});

When('I press the {string} navigation key', async ({ page }, key: string) => {
  // Move focus off any nav link first so the global handler is the only consumer.
  await page.locator('body').press(key);
});

Then('I should be on the {string} section', async ({ page }, route: string) => {
  await page.waitForURL(new RegExp(`#/${route}$`), { timeout: testConfig.timeouts.transition });
});

When('I open the keyboard shortcuts help', async ({ page }) => {
  await page.locator('body').press('Shift+Slash'); // '?'
});

Then('I should see the keyboard shortcuts help', async ({ page }) => {
  await expect(page.getByTestId('keyboard-shortcuts-help')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

Then('the keyboard shortcuts help should close', async ({ page }) => {
  await expect(page.getByTestId('keyboard-shortcuts-help')).toHaveCount(0, {
    timeout: testConfig.timeouts.transition,
  });
});

When('I jump to monitor number {string}', async ({ page }, number: string) => {
  for (const digit of number) {
    await page.locator('body').press(digit);
  }
  await page.locator('body').press('Enter');
});

Then('I should be on a monitor detail page', async ({ page }) => {
  await page.waitForURL(/#\/monitors\/\d+/, { timeout: testConfig.timeouts.transition * 2 });
});
