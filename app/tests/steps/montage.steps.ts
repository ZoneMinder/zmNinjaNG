import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getMonitorCount } from '../helpers/zm-api';

const { When, Then } = createBdd();

let capturedMonitorTestId: string | null = null;

// Presets 1-5 are buttons; higher counts use the custom dialog. The tested
// values (2, 5) are both presets.
async function setMontageColumns(page: Page, cols: number) {
  const trigger = page.getByTestId('montage-layout-trigger');
  await trigger.click();
  const preset = page.getByTestId(`montage-grid-preset-${cols}`);
  await expect(preset).toBeVisible({ timeout: testConfig.timeouts.element });
  await preset.click();
  await expect(trigger).toHaveAttribute('data-grid-cols', String(cols), {
    timeout: testConfig.timeouts.element,
  });
}

// Count tiles whose top edge matches the topmost tile: that is the rendered
// column count of the first row. Reads geometry, not the column setting, so it
// catches a mismatch between the selected count and what is actually laid out.
async function countTopRowTiles(page: Page): Promise<{ topRow: number; total: number }> {
  const tiles = page.locator('[data-testid^="montage-monitor-"]');
  const total = await tiles.count();
  const tops: number[] = [];
  for (let i = 0; i < total; i++) {
    const box = await tiles.nth(i).boundingBox();
    if (box) tops.push(box.y);
  }
  if (tops.length === 0) return { topRow: 0, total };
  const minTop = Math.min(...tops);
  const topRow = tops.filter((tp) => Math.abs(tp - minTop) <= 4).length;
  return { topRow, total };
}

When('I set the montage column count to {int}', async ({ page }, cols: number) => {
  await setMontageColumns(page, cols);
});

Then('the montage grid should render {int} columns', async ({ page }, cols: number) => {
  // Invariant: the first row holds min(cols, total) tiles. With more monitors
  // than columns the bug (5 -> 6) breaks it; with fewer, the row is capped by
  // the monitor count (derived from the tiles present, independent of the
  // column setting under test).
  await expect(async () => {
    const { topRow, total } = await countTopRowTiles(page);
    expect(topRow).toBe(Math.min(cols, total));
  }).toPass({ timeout: testConfig.timeouts.element });
});

Then('the montage grid should lay out tiles in more than one column', async ({ page }) => {
  // Ground truth from the API, not from the tiles under test (rule 34): a
  // server with a single monitor genuinely cannot fill a second column.
  const monitorCount = await getMonitorCount();
  if (monitorCount < 2) return;

  // The grid mounts tiles before react-grid-layout has positioned them, so a
  // geometry read can land while only the first tile exists. Wait for a second
  // tile to exist, then measure. Both are hard assertions.
  await expect
    .poll(async () => (await countTopRowTiles(page)).total, { timeout: testConfig.timeouts.pageLoad })
    .toBeGreaterThanOrEqual(2);

  await expect(async () => {
    const { topRow } = await countTopRowTiles(page);
    expect(topRow).toBeGreaterThan(1);
  }).toPass({ timeout: testConfig.timeouts.pageLoad });
});

When('I focus the first montage tile with the keyboard', async ({ page }) => {
  const tile = page.locator('[data-testid^="montage-monitor-"]').first();
  await expect(tile).toBeVisible({ timeout: testConfig.timeouts.transition });
  await tile.focus();
  await expect(tile).toBeFocused();
});

When('I press Enter on the focused montage tile', async ({ page }) => {
  await page.keyboard.press('Enter');
});

When('I capture the first montage monitor id', async ({ page }) => {
  const tile = page.locator('[data-testid^="montage-monitor-"]').first();
  await expect(tile).toBeVisible({ timeout: testConfig.timeouts.transition });
  const id = await tile.getAttribute('data-testid');
  if (!id) throw new Error('First montage tile has no data-testid');
  capturedMonitorTestId = id;
});

When('I open the montage kebab menu', async ({ page }) => {
  await page.getByTestId('montage-kebab-menu').click();
});

When('I open the montage show-monitors submenu', async ({ page }) => {
  await page.getByTestId('montage-kebab-visibility').hover();
  // Wait for the submenu content to render
  await page.waitForTimeout(150);
});

When('I uncheck the visibility for the captured monitor', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  const monitorId = capturedMonitorTestId.replace('montage-monitor-', '');
  const cb = page.getByTestId(`montage-visibility-${monitorId}`);
  await expect(cb).toHaveAttribute('data-state', 'checked');
  await cb.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I check the visibility for the captured monitor', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  const monitorId = capturedMonitorTestId.replace('montage-monitor-', '');
  const cb = page.getByTestId(`montage-visibility-${monitorId}`);
  await expect(cb).toHaveAttribute('data-state', 'unchecked');
  await cb.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I reload the current page', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
});

Then('the captured monitor tile should not be present in the montage grid', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  await expect(page.getByTestId(capturedMonitorTestId)).toHaveCount(0);
});

Then('the captured monitor tile should be present in the montage grid', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  await expect(page.getByTestId(capturedMonitorTestId)).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});
