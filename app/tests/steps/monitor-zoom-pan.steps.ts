import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Zoom / pan (keyboard + mouse) - issue #191
let panTransformBefore = '';
// Monitor the view was zoomed on, so the reset check below can tell a real
// monitor switch from a server with only one monitor to switch to.
let zoomedMonitorId: string | null = null;

async function readZoomTransform(page: import('@playwright/test').Page): Promise<string> {
  return page
    .getByTestId('monitor-zoom-content')
    .evaluate((el) => (el as HTMLElement).style.transform);
}

When('I scroll the wheel up over the monitor view', async ({ page }) => {
  const box = await page.getByTestId('monitor-zoom-content').boundingBox();
  if (!box) throw new Error('monitor-zoom-content has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Negative deltaY = scroll up = zoom in. Several notches to clear the threshold.
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -120);
  }
  // Zooming past the threshold is what makes the pan buttons appear; wait for
  // that observable effect instead of guessing how long the state update takes.
  await expect(page.getByTestId('pan-left-button')).toBeVisible({ timeout: testConfig.timeouts.transition });
});

When('I zoom into the monitor view', async ({ page }) => {
  zoomedMonitorId = page.url().match(/monitors\/(\d+)/)?.[1] ?? null;
  const zoomIn = page.getByTestId('zoom-in-button');
  await expect(zoomIn).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  // Two steps so the view is well past the zoom threshold with room to pan.
  await zoomIn.click();
  await zoomIn.click();
});

Then('the pan controls should be visible', async ({ page }) => {
  await expect(page.getByTestId('pan-left-button')).toBeVisible();
  await expect(page.getByTestId('pan-right-button')).toBeVisible();
});

When('I pan the view with the {string} arrow key', async ({ page }, key: string) => {
  panTransformBefore = await readZoomTransform(page);
  await page.keyboard.press(key);
  // Pan animates over 0.2s; wait for the transform value to actually change
  // rather than sleeping a fixed duration that may outrun or undershoot it.
  await expect.poll(() => readZoomTransform(page), { timeout: testConfig.timeouts.transition })
    .not.toBe(panTransformBefore);
});

When('I drag the monitor view with the mouse', async ({ page }) => {
  panTransformBefore = await readZoomTransform(page);
  const box = await page.getByTestId('monitor-zoom-content').boundingBox();
  if (!box) throw new Error('monitor-zoom-content has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Several intermediate moves so use-gesture registers a drag, not a tap.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx - (60 * i) / 8, cy);
  }
  await page.mouse.up();
  await expect.poll(() => readZoomTransform(page), { timeout: testConfig.timeouts.transition })
    .not.toBe(panTransformBefore);
});

// Zoom belongs to the picture, not the page (refs #382). Stepping to another
// monitor keeps the page mounted, so the transform has to be cleared explicitly.
Then('the monitor view should be back at fit', async ({ page }) => {
  const nowId = page.url().match(/monitors\/(\d+)/)?.[1] ?? null;
  if (!nowId || nowId === zoomedMonitorId) {
    log.info('E2E: Skipping zoom-reset assertion - no second monitor to switch to', { component: 'e2e' });
    return;
  }
  // The zoom controls collapse back to the two buttons only while the hook
  // itself reports 1x, so this fails if the scale state survives the switch
  // even when the new monitor's element paints unzoomed.
  await expect(page.getByTestId('pan-left-button')).toBeHidden({ timeout: testConfig.timeouts.transition });
  // '' on a freshly mounted element, 'scale(1)' on one the reset wrote to.
  const transform = await readZoomTransform(page);
  expect(transform === '' || transform.includes('scale(1)')).toBe(true);
});

Then('the view should pan', async ({ page }) => {
  const after = await readZoomTransform(page);
  expect(after).not.toBe(panTransformBefore);
});
