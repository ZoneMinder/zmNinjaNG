import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

// Zoom / pan (keyboard + mouse) - issue #191
let panTransformBefore = '';

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
  await page.waitForTimeout(100);
});

When('I zoom into the monitor view', async ({ page }) => {
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
  // Pan animates over 0.2s; wait for the transform to settle.
  await page.waitForTimeout(300);
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
  await page.waitForTimeout(100);
});

Then('the view should pan', async ({ page }) => {
  const after = await readZoomTransform(page);
  expect(after).not.toBe(panTransformBefore);
});
