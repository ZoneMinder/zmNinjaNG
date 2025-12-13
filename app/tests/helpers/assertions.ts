import { expect, Page } from '@playwright/test';

/**
 * Common assertions for e2e tests
 */

export async function assertPageLoaded(page: Page, pageNameRegex: RegExp) {
  await expect(page).toHaveURL(pageNameRegex);
  await expect(page.locator('body')).not.toContainText('Application Error');
}

export async function assertNoErrors(page: Page) {
  await expect(page.locator('body')).not.toContainText('Application Error');
  await expect(page.locator('body')).not.toContainText('Something went wrong');
}

export async function assertNavigationExists(page: Page) {
  // Check sidebar exists (desktop or mobile)
  const desktopSidebar = page.locator('aside').first();
  const mobileMenu = page.getByRole('button', { name: /menu/i });

  const hasSidebar = await desktopSidebar.isVisible().catch(() => false);
  const hasMenu = await mobileMenu.isVisible().catch(() => false);

  expect(hasSidebar || hasMenu).toBeTruthy();
}
