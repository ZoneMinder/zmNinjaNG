import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getMonitorCount, getMonitorEventCountSince } from '../helpers/zm-api';
import { MONTAGE_SCROLL_PAD } from '../../src/lib/zmninja-ng-constants';

const { When, Then } = createBdd();

let capturedMonitorTestId: string | null = null;

// A fixed old watermark: any monitor with events after this date shows a
// badge. Mirrors monitors.steps.ts "I seed old watermarks for monitors with
// events" (refs #239): the montage tile's badge is the same "events since
// you last looked" mechanism as the monitors card, just wired through
// Montage.tsx instead of Monitors.tsx.
const OLD_WATERMARK = '2020-01-01 00:00:00';
let seededMontageMonitorIds: string[] = [];
let badgedMontageMonitorId: string | null = null;

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

// New-events badge steps (refs #239). A fresh Playwright context has empty
// localStorage, so every monitor is unseeded: the first "events since"
// response seeds it and reports zero, meaning no badge ever renders on a
// virgin page load (asserted below by the "vacuity" pass with the guard
// disabled). To exercise the badge, write an old watermark for monitors the
// API (not the UI) confirms have events after it, then reload so the
// persisted zustand store rehydrates from that seeded localStorage.
When('I seed old watermarks for montage monitors with events', async ({ page }) => {
  const profileId = await page.evaluate(() => {
    const raw = localStorage.getItem('zmng-profiles');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { currentProfileId?: string | null } };
    return parsed.state?.currentProfileId ?? null;
  });
  expect(profileId, 'expected a current profile id in zmng-profiles after login').toBeTruthy();

  const tiles = page.locator('[data-testid^="montage-monitor-"]');
  await expect(tiles.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  const testIds = (await tiles.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid'))
  )).filter((id): id is string => !!id);
  const ids = testIds.map((id) => id.replace('montage-monitor-', ''));
  expect(ids.length, 'expected at least one rendered montage tile').toBeGreaterThan(0);

  // Ground truth from the ZM API: only monitors with events after the
  // watermark are expected to badge (rule 34).
  const withEvents: string[] = [];
  for (const id of ids) {
    const count = await getMonitorEventCountSince(id, OLD_WATERMARK);
    if (count > 0) withEvents.push(id);
  }
  expect(
    withEvents.length,
    'need at least 1 monitor with events since 2020-01-01 on the test server to exercise the montage new-events badge'
  ).toBeGreaterThanOrEqual(1);
  seededMontageMonitorIds = withEvents;

  await page.evaluate(
    ({ key, profileId, monitorIds, since }) => {
      const watermarks: Record<string, string> = {};
      for (const id of monitorIds) watermarks[id] = since;
      const payload = {
        state: { profileWatermarks: { [profileId]: watermarks } },
        version: 0,
      };
      localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: 'zmng-monitor-seen', profileId: profileId as string, monitorIds: withEvents, since: OLD_WATERMARK }
  );
});

Then('a montage tile should show the new-events badge', async ({ page }) => {
  const badges = page.locator('[data-testid="montage-new-events-badge"]');
  await expect
    .poll(() => badges.count(), { timeout: testConfig.timeouts.pageLoad })
    .toBeGreaterThanOrEqual(1);

  badgedMontageMonitorId = null;
  for (const id of seededMontageMonitorIds) {
    const tile = page.getByTestId(`montage-monitor-${id}`);
    if (await tile.getByTestId('montage-new-events-badge').count()) {
      badgedMontageMonitorId = id;
      break;
    }
  }
  expect(
    badgedMontageMonitorId,
    `expected a badge on at least one of the ${seededMontageMonitorIds.length} monitor(s) the API confirmed have events since the seeded watermark`
  ).not.toBeNull();
});

When('I click the events button on a badged montage tile', async ({ page }) => {
  if (!badgedMontageMonitorId) throw new Error('No badged montage tile recorded');
  const tile = page.getByTestId(`montage-monitor-${badgedMontageMonitorId}`);
  await tile.getByTestId('montage-events-btn').click();
});

Then('the events page should open filtered to that monitor since the watermark', async ({ page }) => {
  if (!badgedMontageMonitorId) throw new Error('No badged montage tile recorded');
  await page.waitForURL(/\/events\?monitorId=\d+&startDateTime=/, {
    timeout: testConfig.timeouts.transition,
  });
  // HashRouter: the route and its query string live after the `#`, so
  // `new URL(...).searchParams` (which only parses before `#`) reads nothing.
  const hash = new URL(page.url()).hash.replace(/^#/, '');
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  expect(params.get('monitorId')).toBe(badgedMontageMonitorId);
  expect(params.get('startDateTime')).toBeTruthy();
});

// Edit-mode scroll pad (refs #321). In edit mode every tile is a drag surface,
// so a touch swipe reorders monitors instead of scrolling; the pad is the only
// way to move the viewport without moving a monitor.
let scrollPadScrollTop = 0;
let scrollPadStep = 0;
let scrollPadTileOrder: string[] = [];

// The montage grid's own container is as tall as its content, so the element
// that scrolls is the app's <main>, the same one monitor detail restores.
function readGridScroll(page: Page): Promise<{ top: number; overflow: number; visible: number }> {
  return page.locator('[data-tv-region="main"]').evaluate((el) => ({
    top: el.scrollTop,
    overflow: el.scrollHeight - el.clientHeight,
    visible: el.clientHeight,
  }));
}

// Tile order as laid out, not as mounted: react-grid-layout keeps the DOM
// order fixed and positions tiles with transforms, so a reorder only shows up
// in geometry.
async function readTileOrder(page: Page): Promise<string[]> {
  const tiles = page.locator('[data-testid^="montage-monitor-"]');
  const placed: { id: string; top: number; left: number }[] = [];
  for (const tile of await tiles.all()) {
    const id = (await tile.getAttribute('data-testid')) ?? '';
    const box = await tile.boundingBox();
    if (box) placed.push({ id, top: box.y, left: box.x });
  }
  placed.sort((a, b) => a.top - b.top || a.left - b.left);
  return placed.map((p) => p.id);
}

When('I enter montage edit mode', async ({ page }) => {
  await page.getByTestId('montage-edit-toggle').click();
  await expect(page.getByTestId('montage-scroll-pad-toggle')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

When('I toggle the montage scroll pad', async ({ page }) => {
  await page.getByTestId('montage-scroll-pad-toggle').click();
});

Then('the montage scroll pad should be visible', async ({ page }) => {
  await expect(page.getByTestId('montage-scroll-pad')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

Then('the montage scroll pad should be hidden', async ({ page }) => {
  await expect(page.getByTestId('montage-scroll-pad')).toHaveCount(0);
});

When('I record the montage grid scroll position and tile order', async ({ page }) => {
  const { top, overflow, visible } = await readGridScroll(page);
  scrollPadStep = visible * MONTAGE_SCROLL_PAD.stepFraction;
  // One column of tiles has to be taller than the viewport for scrolling to
  // mean anything. That is a property of the grid under test, so assert it
  // rather than skipping on it.
  expect(overflow).toBeGreaterThan(0);
  scrollPadScrollTop = top;
  scrollPadTileOrder = await readTileOrder(page);
  expect(scrollPadTileOrder.length).toBeGreaterThan(0);
});

When('I tap the montage scroll pad down button', async ({ page }) => {
  await page.getByTestId('montage-scroll-down').click();
});

When('I tap the montage scroll pad top button', async ({ page }) => {
  await page.getByTestId('montage-scroll-top').click();
});

Then('the montage grid should have scrolled down', async ({ page }) => {
  // A full step, not merely "moved": Playwright scrolls a button into view
  // before clicking it, so any weaker assertion passes even when the pad does
  // nothing at all.
  await expect
    .poll(async () => (await readGridScroll(page)).top, {
      timeout: testConfig.timeouts.transition,
    })
    .toBeGreaterThanOrEqual(scrollPadScrollTop + scrollPadStep);
});

Then('the montage grid should be scrolled to the top', async ({ page }) => {
  await expect
    .poll(async () => (await readGridScroll(page)).top, {
      timeout: testConfig.timeouts.transition,
    })
    .toBe(0);
});

Then('the montage tile order should be unchanged', async ({ page }) => {
  expect(await readTileOrder(page)).toEqual(scrollPadTileOrder);
});
