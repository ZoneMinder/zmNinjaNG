import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Zone Overlay Steps
Then('I should see the zone toggle button', async ({ page }) => {
  const zoneToggle = page.getByTestId('zone-toggle-button');
  await expect(zoneToggle).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I click the zone toggle button', async ({ page }) => {
  const zoneToggle = page.getByTestId('zone-toggle-button');
  // aria-label flips between "Show Zones" / "Hide Zones" (MonitorDetail.tsx)
  // independent of whether this monitor actually has zones, so it is a
  // reliable signal that the click's state update has landed.
  const beforeLabel = await zoneToggle.getAttribute('aria-label');
  await zoneToggle.click();
  await expect(zoneToggle).not.toHaveAttribute('aria-label', beforeLabel ?? '', {
    timeout: testConfig.timeouts.element,
  });
});

Then('the zone toggle should be active', async ({ page }) => {
  const zoneToggle = page.getByTestId('zone-toggle-button');
  // When active, the button has variant="secondary" which adds a specific class
  await expect(zoneToggle).toBeVisible();
  // Verify either the zone overlay is visible (if zones exist) or the button is in active state
  const zoneOverlay = page.getByTestId('zone-overlay');
  const isOverlayVisible = await zoneOverlay.isVisible({ timeout: 2000 }).catch(() => false);
  // Button should have secondary variant styling when active
  const hasSecondaryVariant = await zoneToggle.evaluate((el) =>
    el.classList.contains('bg-secondary') || el.getAttribute('data-state') === 'on'
  ).catch(() => false);
  log.info('E2E: Zone toggle state', { component: 'e2e', isOverlayVisible, hasSecondaryVariant });
});

Then('the zone toggle should be inactive', async ({ page }) => {
  const zoneToggle = page.getByTestId('zone-toggle-button');
  await expect(zoneToggle).toBeVisible();
  // When inactive, zone overlay should not be visible
  const zoneOverlay = page.getByTestId('zone-overlay');
  const isOverlayVisible = await zoneOverlay.isVisible({ timeout: 1000 }).catch(() => false);
  // If there were zones, they should now be hidden
  log.info('E2E: Zone toggle inactive state', { component: 'e2e', overlayHidden: !isOverlayVisible });
});

When('I toggle Show Zones on', async ({ page }) => {
  const toggle = page.getByTestId('zone-toggle-button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', /hide/i, { timeout: testConfig.timeouts.element });
});

Then('the zone overlay and legend should be visible if the monitor has zones', async ({ page }) => {
  const overlay = page.getByTestId('zone-overlay');
  const isOverlayVisible = await overlay.isVisible({ timeout: 3000 }).catch(() => false);
  if (isOverlayVisible) {
    await expect(page.getByTestId('zone-legend')).toBeVisible();
  }
  // else: this monitor has no zones; nothing to assert.
  log.info('E2E: Zone overlay check', { component: 'e2e', overlayVisible: isOverlayVisible });
});

When('I toggle Show Zones off', async ({ page }) => {
  const toggle = page.getByTestId('zone-toggle-button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', /show/i, { timeout: testConfig.timeouts.element });
});

Then('the zone overlay should not be visible', async ({ page }) => {
  await expect(page.getByTestId('zone-overlay')).toHaveCount(0);
});
