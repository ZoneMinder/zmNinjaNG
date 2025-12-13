import { Page } from '@playwright/test';

/**
 * Navigation helper for e2e tests
 * Provides reusable functions to navigate between pages
 */

export async function navigateToDashboard(page: Page) {
  await page.getByRole('link', { name: /dashboard/i }).click();
  await page.waitForURL(/.*dashboard/);
}

export async function navigateToMonitors(page: Page) {
  await page.getByRole('link', { name: /monitors/i }).first().click();
  await page.waitForURL(/.*monitors/);
}

export async function navigateToMontage(page: Page) {
  await page.getByRole('link', { name: /montage/i }).first().click();
  await page.waitForURL(/.*montage/);
}

export async function navigateToEvents(page: Page) {
  await page.getByRole('link', { name: /events/i }).first().click();
  await page.waitForURL(/.*events/);
}

export async function navigateToEventMontage(page: Page) {
  await page.getByRole('link', { name: /event.montage/i }).click();
  await page.waitForURL(/.*event-montage/);
}

export async function navigateToTimeline(page: Page) {
  await page.getByRole('link', { name: /timeline/i }).click();
  await page.waitForURL(/.*timeline/);
}

export async function navigateToNotifications(page: Page) {
  await page.getByRole('link', { name: /notifications/i }).first().click();
  await page.waitForURL(/.*notifications/);
}

export async function navigateToProfiles(page: Page) {
  await page.getByRole('link', { name: /profiles/i }).click();
  await page.waitForURL(/.*profiles/);
}

export async function navigateToSettings(page: Page) {
  await page.getByRole('link', { name: /settings/i }).click();
  await page.waitForURL(/.*settings/);
}

export async function navigateToServer(page: Page) {
  await page.getByRole('link', { name: /server/i }).click();
  await page.waitForURL(/.*server/);
}

export async function navigateToLogs(page: Page) {
  await page.getByRole('link', { name: /logs/i }).click();
  await page.waitForURL(/.*logs/);
}
