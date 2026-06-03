import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Then } = createBdd();

// The expanded desktop sidebar shows "v<version> (<build>)", e.g. "v1.1.14 (1509)".
// The build number is the git commit count injected by vite.config.ts, or "dev"
// outside a git checkout.
Then('the sidebar version label should show a version and build number', async ({ page }) => {
  const label = page.getByTestId('sidebar-app-version');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(/^v\d+\.\d+\.\d+.*\((\d+|dev)\)$/);
});
