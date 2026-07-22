import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getAlarmStatus } from '../helpers/zm-api';
import { STORAGE_KEYS } from '../../src/lib/zmninja-ng-constants';
import type { AssistantTurn } from '../../src/lib/assistant/types';

const { Given, When, Then } = createBdd();

// Reused from existing steps (do NOT redefine here):
// Given('I am logged into zmNinjaNg')            -> common.steps.ts
// Then('I should see the keyboard shortcuts help') -> keyboard-shortcuts.steps.ts

/**
 * Enables the assistant and arms deterministic test mode.
 *
 * Playwright's bundled Chromium exposes a real (getter-only) `navigator.gpu`
 * whose `requestAdapter()` resolves `null` in the headless/CI environment
 * (no real GPU), which is exactly the "no usable adapter" case
 * `useWebGpuAvailable` (backed by `lib/assistant/webgpu.ts`) is meant to
 * catch, so `assistant-enabled-toggle` would stay disabled without this
 * stub. `navigator.gpu` has no setter, so a plain assignment silently
 * no-ops; `Object.defineProperty` is required to actually replace it. This
 * is e2e-only: the app's WebGPU probe is unmodified, so a real "no WebGPU"
 * device (or one whose `requestAdapter()` genuinely resolves `null`) still
 * sees the disabled toggle.
 */
Given('the assistant is enabled with the mock backend', async ({ page }) => {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, '1');
    Object.defineProperty(navigator, 'gpu', {
      value: { requestAdapter: () => Promise.resolve({}) },
      configurable: true,
      writable: true,
    });
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
    { toolCalls: [{ id: '1', name: 'count_events', input: { lastCount: 1, lastUnit: 'day' } }] },
    { text: answer, toolCalls: [] },
  ]);
});

/** A model that reaches for the withheld action: the loop refuses the call
 *  (WITHHELD_TOOL_REFUSAL in agent.ts, no destructive tools exist) and the
 *  second scripted turn is the model relaying that refusal to the user. */
Given('the assistant will call trigger_alarm and then relay the refusal', async ({ page }) => {
  await seedScript(page, [
    { toolCalls: [{ id: '1', name: 'trigger_alarm', input: { monitorId: '1' } }] },
    { text: 'I cannot trigger alarms. Do that from the Monitors screen.', toolCalls: [] },
  ]);
});

/** The window `sharedMockProvider` claims, standing in for an on-device model's
 *  known context size. AskPanel reads it under the same `isAssistantTestMode()`
 *  gate as the script (see the seam's declaration in AskPanel.tsx). */
Given('the assistant backend has a context window of {string} tokens', async ({ page }, tokens: string) => {
  await page.evaluate((n) => {
    (window as unknown as { __assistantMockContextWindow?: number }).__assistantMockContextWindow = n;
  }, Number(tokens));
});

/** A count_events round then an answer reporting `promptTokens`, which is
 *  what the auto-clear threshold is measured against. The tool round is not
 *  decoration: the scenario asks an events question, and the loop's live-data
 *  requirement (agent.ts) holds any events question to a successful
 *  list_events/count_events call before it accepts an answer. */
Given(
  'the assistant will answer {string} using {string} prompt tokens',
  async ({ page }, answer: string, promptTokens: string) => {
    await seedScript(page, [
      { toolCalls: [{ id: '1', name: 'count_events', input: { lastCount: 1, lastUnit: 'day' } }] },
      {
        text: answer,
        toolCalls: [],
        usage: { promptTokens: Number(promptTokens), completionTokens: 10, totalTokens: Number(promptTokens) + 10 },
      },
    ]);
  },
);

Then('the context-cleared notice should be visible', async ({ page }) => {
  await expect(page.getByTestId('assistant-context-cleared')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

Then('the context-cleared notice should not be visible', async ({ page }) => {
  // The reply is already asserted before this step, so the turn has finished:
  // a notice that were coming would already be in the DOM, making this a real
  // assertion rather than a race with an unfinished turn.
  await expect(page.getByTestId('assistant-context-cleared')).toHaveCount(0);
});

When('I press the {string} key', async ({ page }, key: string) => {
  await page.locator('body').press(key === '?' ? 'Shift+Slash' : key);
});

Then('the assistant panel should open', async ({ page }) => {
  // The floating assistant panel (components/assistant/AssistantWidget.tsx),
  // not the command palette: refs #246 moved the assistant out of the
  // palette into its own persistent window. AskPanel's message input must
  // hold focus so a keyboard user can start typing without an extra click.
  await expect(page.getByTestId('assistant-panel')).toBeVisible({ timeout: testConfig.timeouts.transition });
  await expect(page.getByTestId('ask-panel')).toBeVisible({ timeout: testConfig.timeouts.transition });
  await expect(page.getByTestId('assistant-input')).toBeFocused({ timeout: testConfig.timeouts.transition });
});

Then('I should see the example prompt {string}', async ({ page }, text: string) => {
  await expect(page.getByTestId('assistant-example-prompt').filter({ hasText: text })).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

When('I click the example prompt {string}', async ({ page }, text: string) => {
  await page.getByTestId('assistant-example-prompt').filter({ hasText: text }).click();
});

// Clicking a chip fills the input rather than sending (AssistantIntro), so the
// user can edit before the turn starts. Assert the value landed, not that a
// reply appeared.
Then('the assistant input should contain {string}', async ({ page }, text: string) => {
  await expect(page.getByTestId('assistant-input')).toHaveValue(text, {
    timeout: testConfig.timeouts.transition,
  });
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

// Ground truth from the server (rule 34): the refusal text proves the UI
// outcome, but the alarm state itself is asserted from the API so a
// regression that let a withheld tool execute (agent.ts) can't pass by
// leaving the monitor's real state unchecked. The step needs no Playwright
// fixture, but playwright-bdd requires an object-destructuring first argument
// to detect that (an empty pattern reads as "no fixtures requested").
// eslint-disable-next-line no-empty-pattern
Then('monitor {string} should not be in alarm', async ({}, monitorId: string) => {
  await expect.poll(() => getAlarmStatus(monitorId), { timeout: testConfig.timeouts.transition }).toBe(false);
});

/** Seeds `window.__nativeLlmMockSupported`, the seam `useNativeLlmSupported`
 *  reads (gated by `isAssistantTestMode()`) instead of the real
 *  `Platform.isNative` + `NativeLlm.isSupported()` probe: Chromium e2e has no
 *  real native bridge to fake, and `NativeLlm` has no `web` jsImplementation,
 *  so a genuine probe always rejects there. Cast rather than relying on the
 *  ambient `Window.__nativeLlmMockSupported` declaration (same reasoning as
 *  `seedScript` above: this steps file is a separate tsc project that never
 *  imports the hook). Must run before the step that (re)mounts
 *  `AssistantSection` (the hook's probe effect has an empty dependency array
 *  and only runs on mount). */
Given('the native LLM backend reports as supported', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __nativeLlmMockSupported?: boolean }).__nativeLlmMockSupported = true;
  });
});

When('I select the native backend', async ({ page }) => {
  await page.getByTestId('assistant-backend-select').selectOption('native');
});

Then('I should see the native backend option', async ({ page }) => {
  await expect(page.getByTestId('assistant-backend-select').locator('option[value="native"]')).toHaveCount(1, {
    timeout: testConfig.timeouts.element,
  });
});

Then('I should not see the native backend option', async ({ page }) => {
  await expect(page.getByTestId('assistant-backend-select').locator('option[value="native"]')).toHaveCount(0, {
    timeout: testConfig.timeouts.element,
  });
});

Then('I should see the native model download button', async ({ page }) => {
  await expect(page.getByTestId('assistant-native-model-download')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

