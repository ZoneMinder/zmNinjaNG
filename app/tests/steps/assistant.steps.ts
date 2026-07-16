import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getAlarmStatus, cancelAlarmDirect } from '../helpers/zm-api';
import { STORAGE_KEYS } from '../../src/lib/zmninja-ng-constants';
import type { AssistantTurn } from '../../src/lib/assistant/types';

const { Given, When, Then } = createBdd();

// Reused from existing steps (do NOT redefine here):
// Given('I am logged into zmNinjaNg')            -> common.steps.ts
// Then('I should see the keyboard shortcuts help') -> keyboard-shortcuts.steps.ts

/**
 * Enables the assistant and arms deterministic test mode.
 *
 * `navigator.gpu` is undefined in Playwright's bundled Chromium, which would
 * otherwise leave `assistant-enabled-toggle` disabled (AssistantSection.tsx's
 * `hasWebGPU` gate). Stubbing it here is e2e-only: the app's WebGPU probe is
 * unmodified, so a real "no WebGPU" device still sees the disabled toggle.
 */
Given('the assistant is enabled with the mock backend', async ({ page }) => {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, '1');
    (navigator as unknown as { gpu?: unknown }).gpu = {};
  }, STORAGE_KEYS.assistantTestMode);

  await page.getByTestId('nav-item-settings').first().click();
  await page.waitForURL(/#\/settings$/, { timeout: testConfig.timeouts.transition });

  const toggle = page.getByTestId('assistant-enabled-toggle');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.element });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true', {
    timeout: testConfig.timeouts.transition,
  });

  await page.getByTestId('nav-item-dashboard').first().click();
  await page.waitForURL(/#\/dashboard$/, { timeout: testConfig.timeouts.transition });
});

/** Seeds `window.__assistantMockScript`, the test seam AskPanel reads
 *  (gated by `isAssistantTestMode()`) before running a turn. The ambient
 *  `Window.__assistantMockScript` type lives in AskPanel.tsx (the seam's one
 *  production file); this steps file is a separate tsc project
 *  (tsconfig.tests.json) that never imports AskPanel.tsx, so the property is
 *  cast here instead of relying on that declaration being visible. */
async function seedScript(page: import('@playwright/test').Page, script: AssistantTurn[]): Promise<void> {
  await page.evaluate((s) => {
    (window as unknown as { __assistantMockScript?: AssistantTurn[] }).__assistantMockScript = s;
  }, script);
}

Given('the assistant will answer {string} after calling count_events', async ({ page }, answer: string) => {
  await seedScript(page, [
    { toolCalls: [{ id: '1', name: 'count_events', input: { interval: '1 day' } }] },
    { text: answer, toolCalls: [] },
  ]);
});

Given('the assistant will call trigger_alarm on monitor {string}', async ({ page }, monitorId: string) => {
  await seedScript(page, [{ toolCalls: [{ id: '1', name: 'trigger_alarm', input: { monitorId } }] }]);
});

When('I press the {string} key', async ({ page }, key: string) => {
  await page.locator('body').press(key === '?' ? 'Shift+Slash' : key);
});

Then('the assistant panel should open', async ({ page }) => {
  await expect(page.getByTestId('ask-panel')).toBeVisible({ timeout: testConfig.timeouts.transition });

  // Ask mode renders exactly one text input (refs #246): the palette's own
  // command-search input must not be present, and AskPanel's message input
  // must hold focus so a keyboard user can start typing without an extra
  // click. Regression coverage for the "typed into the dead top input"
  // finding from the whole-branch review.
  await expect(page.getByTestId('command-palette-input')).toHaveCount(0);
  await expect(page.getByTestId('assistant-input')).toBeFocused({ timeout: testConfig.timeouts.transition });
});

When('I ask {string}', async ({ page }, text: string) => {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
});

Then('the assistant reply should contain {string}', async ({ page }, text: string) => {
  await expect(page.getByTestId('assistant-message-assistant').last()).toContainText(text, {
    timeout: testConfig.timeouts.transition,
  });
});

Then('an activity chip for {string} should have appeared', async ({ page }, toolName: string) => {
  await expect(page.getByTestId('assistant-activities')).toContainText(toolName, {
    timeout: testConfig.timeouts.transition,
  });
});

Then('the assistant confirm card should be visible', async ({ page }) => {
  await expect(page.getByTestId('assistant-confirm')).toBeVisible({ timeout: testConfig.timeouts.transition });
});

When('I cancel the confirmation', async ({ page }) => {
  await page.getByTestId('assistant-confirm-cancel').click();
});

When('I confirm the confirmation', async ({ page }) => {
  await page.getByTestId('assistant-confirm-accept').click();
});

// Ground truth from the server (rule 34): the confirm/cancel click proves the
// UI decision, but the alarm state itself is asserted from the API so a
// regression in the confirm gate (agent.ts) can't pass by leaving the
// monitor's real state unchecked. Neither step needs a Playwright fixture,
// but playwright-bdd requires an object-destructuring first argument to
// detect that (an empty pattern reads as "no fixtures requested").
// eslint-disable-next-line no-empty-pattern
Then('monitor {string} should not be in alarm', async ({}, monitorId: string) => {
  await expect.poll(() => getAlarmStatus(monitorId), { timeout: testConfig.timeouts.transition }).toBe(false);
});

// eslint-disable-next-line no-empty-pattern
Then('monitor {string} should be in alarm', async ({}, monitorId: string) => {
  await expect.poll(() => getAlarmStatus(monitorId), { timeout: testConfig.timeouts.pageLoad }).toBe(true);

  // Cleanup: the scenario proved the assistant can trigger the alarm above;
  // leaving it armed would fail unrelated monitor-state assertions in later runs.
  await cancelAlarmDirect(monitorId);
  await expect.poll(() => getAlarmStatus(monitorId), { timeout: testConfig.timeouts.transition }).toBe(false);
});
