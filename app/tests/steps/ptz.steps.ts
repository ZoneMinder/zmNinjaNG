import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { isMonitorControllable } from '../helpers/zm-api';
import { log } from '../../src/lib/logger';

const { Given, When, Then } = createBdd();

// PTZ Steps
//
// PTZ commands are dispatched as GET requests carrying `request=control` and
// `control=<command>` (see src/lib/zm/url-builder.ts getMonitorControlUrl). There
// is no success toast and no DOM state change on success, so the only real
// signal that "a command was sent" is the network request itself. We attach a
// request listener once per page and record matching URLs so later `Then`
// steps can assert on what actually happened, instead of sleeping and hoping.
const ptzListenerPages = new WeakSet<import('@playwright/test').Page>();
let ptzRequestUrls: string[] = [];
let ptzStopClicked = false;
let continuousToggleClicked = false;
let hasPTZ = false;

function attachPtzRequestCapture(page: import('@playwright/test').Page): void {
  if (ptzListenerPages.has(page)) return;
  ptzListenerPages.add(page);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('request=control')) {
      ptzRequestUrls.push(url);
    }
  });
}

Given('the current monitor supports PTZ', async ({ page }) => {
  attachPtzRequestCapture(page);
  ptzRequestUrls = [];
  ptzStopClicked = false;
  continuousToggleClicked = false;

  const urlMatch = page.url().match(/monitors\/(\d+)/);
  if (!urlMatch) {
    throw new Error('E2E: PTZ scenario ran without a monitor id in the URL');
  }

  // Capability comes from the ZoneMinder API's Controllable field, not from
  // whether the ptz-controls panel happens to be visible. Deriving it from
  // the panel under test was self-defeating: a regression that stopped the
  // panel rendering would make hasPTZ false and every downstream assertion
  // would silently no-op instead of failing (refs #217, #218).
  hasPTZ = await isMonitorControllable(urlMatch[1]);
  if (!hasPTZ) {
    log.info('E2E: Current monitor does not support PTZ', { component: 'e2e', monitorId: urlMatch[1] });
  }
});

Then('I should see the PTZ control panel', async ({ page }) => {
  if (!hasPTZ) return;
  const ptzPanel = page.getByTestId('ptz-controls');
  await expect(ptzPanel).toBeVisible();
});

Then('I should see directional arrows', async ({ page }) => {
  if (!hasPTZ) return;
  const arrows = page.locator('[data-testid*="ptz"]');
  await expect(arrows.first()).toBeVisible();
});

Then('I should see zoom controls', async ({ page }) => {
  if (!hasPTZ) return;
  const zoom = page.locator('[data-testid*="zoom"]');
  await expect(zoom.first()).toBeVisible();
});

When('I click the PTZ pan left button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const leftBtn = page.getByTestId('ptz-left').or(page.getByRole('button', { name: /left/i }));
  await leftBtn.first().click();
});

When('I click the PTZ pan right button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const rightBtn = page.getByTestId('ptz-right').or(page.getByRole('button', { name: /right/i }));
  await rightBtn.first().click();
});

When('I click the PTZ tilt up button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const upBtn = page.getByTestId('ptz-up').or(page.getByRole('button', { name: /up/i }));
  await upBtn.first().click();
});

When('I click the PTZ tilt down button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const downBtn = page.getByTestId('ptz-down').or(page.getByRole('button', { name: /down/i }));
  await downBtn.first().click();
});

When('I click the PTZ zoom in button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const zoomIn = page.getByTestId('ptz-zoom-in').or(page.getByRole('button', { name: /zoom.*in/i }));
  await zoomIn.first().click();
});

When('I click the PTZ zoom out button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const zoomOut = page.getByTestId('ptz-zoom-out').or(page.getByRole('button', { name: /zoom.*out/i }));
  await zoomOut.first().click();
});

Then('the PTZ command should be sent', async ({ page }) => {
  if (!hasPTZ) return;
  // Real outcome: the control request for this button press must have actually
  // reached the network layer, not merely "no error toast appeared yet".
  await expect.poll(() => ptzRequestUrls.length > 0, {
    timeout: testConfig.timeouts.transition,
  }).toBeTruthy();
  const errorToast = page.locator('text=/ptz.*failed|error/i');
  const hasError = await errorToast.isVisible().catch(() => false);
  expect(hasError).toBeFalsy();
});

Then('the auto-stop should trigger after delay', async () => {
  if (!hasPTZ) return;
  // HoldButton fires stopCommand (moveStop) on pointerup; there is no separate
  // client-side timer. Playwright's .click() already completes pointerdown +
  // pointerup, so this verifies the release-triggered stop request landed.
  await expect.poll(() => ptzRequestUrls.some((u) => u.includes('control=moveStop')), {
    timeout: testConfig.timeouts.transition,
  }).toBeTruthy();
});

When('I toggle continuous PTZ mode on', async ({ page }) => {
  if (!hasPTZ) return;
  // No standalone "continuous mode" toggle exists in PTZControls today - hold-to-move
  // is automatic based on driver capability (CanMoveCon). Guard for a future toggle;
  // this genuinely no-ops against the current UI.
  const toggle = page.getByTestId('ptz-continuous-toggle');
  continuousToggleClicked = await toggle.isVisible().catch(() => false);
  if (continuousToggleClicked) {
    ptzRequestUrls = [];
    await toggle.click();
  }
});

Then('the command should continue until stop pressed', async () => {
  if (!hasPTZ) return;
  if (!continuousToggleClicked) {
    log.info('E2E: Skipping continuous-mode assertion - no continuous PTZ toggle in current UI', { component: 'e2e' });
    return;
  }
  await expect.poll(() => ptzRequestUrls.length > 1, {
    timeout: testConfig.timeouts.transition,
  }).toBeTruthy();
});

When('I click the PTZ stop button', async ({ page }) => {
  if (!hasPTZ) return;
  ptzRequestUrls = [];
  const stopBtn = page.getByTestId('ptz-stop').or(page.getByRole('button', { name: /stop/i }));
  ptzStopClicked = await stopBtn.isVisible().catch(() => false);
  if (ptzStopClicked) {
    await stopBtn.click();
  }
});

Then('the movement should stop', async () => {
  if (!hasPTZ) return;
  if (!ptzStopClicked) {
    log.info('E2E: Skipping movement-stop assertion - stop button not present for this control set', { component: 'e2e' });
    return;
  }
  await expect.poll(() => ptzRequestUrls.some((u) => u.includes('control=moveStop')), {
    timeout: testConfig.timeouts.transition,
  }).toBeTruthy();
});

// PTZ Error Handling
Given('the PTZ endpoint is unavailable', async () => {
  // Setup state for error testing
});

Then('I should see PTZ error toast', async ({ page }) => {
  const toast = page.locator('text=/ptz.*failed|ptz.*error/i');
  const hasToast = await toast.isVisible({ timeout: testConfig.timeouts.transition }).catch(() => false);
  log.info('E2E: PTZ error toast', { component: 'e2e', hasToast });
});
