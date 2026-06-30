import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

// Reused from existing steps (do NOT redefine here):
// Given('I am logged into zmNinjaNg')         -> common.steps.ts
// When('I navigate to the {string} page')      -> common.steps.ts
// Then('I should be on the {string} section')  -> keyboard-shortcuts.steps.ts
// When('I press Escape key')                   -> common.steps.ts

When('I press the slash key', async ({ page }) => {
  await page.locator('body').press('/');
});

Then('I should see the command palette', async ({ page }) => {
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: testConfig.timeouts.element });
  await expect(page.getByTestId('command-palette-input')).toBeFocused();
});

When('I type {string} into the command palette', async ({ page }, text: string) => {
  await page.getByTestId('command-palette-input').fill(text);
});

When('I press Enter in the command palette', async ({ page }) => {
  await page.getByTestId('command-palette-input').press('Enter');
});

When('I open the command palette from the sidebar', async ({ page }) => {
  await page.getByTestId('command-palette-trigger-sidebar').click();
});

Then('the command palette should close', async ({ page }) => {
  await expect(page.getByTestId('command-palette')).toBeHidden({ timeout: testConfig.timeouts.element });
});
