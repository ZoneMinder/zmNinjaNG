import { test as setup } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

/**
 * Authentication Setup
 * Note: Authentication is now handled in the main test flow
 * This setup just creates an empty auth file for Playwright
 */
setup('prepare auth state', async ({ page }) => {
  // Create empty auth state - actual auth happens in app-flow.spec.ts
  await page.context().storageState({ path: authFile });
  console.log('[Setup] Auth state file created');
});
