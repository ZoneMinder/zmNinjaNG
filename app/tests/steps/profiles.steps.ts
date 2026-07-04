import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

let updatedProfileName = '';
let newProfileName = '';

// Profile Steps
Then('I should see at least {int} profile cards', async ({ page }, count: number) => {
  // Wait for profile data to load - the profiles page renders cards with data-testid="profile-card"
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(count);

  const profileCount = await page.locator('[data-testid="profile-card"]').count();
  log.info('E2E profiles found', { component: 'e2e', action: 'profiles_count', count: profileCount });
});

Then('I should see the active profile indicator', async ({ page }) => {
  // Wait for profiles to load first, then check for the active indicator
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(1);

  await expect(page.getByTestId('profile-active-indicator').first()).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

Then('I should see profile management buttons', async ({ page }) => {
  const addButton = page.getByRole('button', { name: /add/i }).first();
  await expect(addButton).toBeVisible();
});

When('I open the edit dialog for the first profile', async ({ page }) => {
  const editButton = page.locator('[data-testid^="profile-edit-button-"]').first();
  await editButton.click();
});

Then('I should see the profile edit dialog', async ({ page }) => {
  await expect(page.getByTestId('profile-edit-dialog')).toBeVisible();
});

When('I cancel profile edits', async ({ page }) => {
  await page.getByTestId('profile-edit-cancel').click();
});

Then('I should see the profiles list', async ({ page }) => {
  await expect(page.getByTestId('profile-list')).toBeVisible();
});

Then('I should see the profile delete dialog', async ({ page }) => {
  await expect(page.getByTestId('profile-delete-dialog')).toBeVisible();
});

When('I cancel profile deletion', async ({ page }) => {
  await page.getByTestId('profile-delete-cancel').click();
});

// New profile interaction steps

When('I change the profile name to a new value', async ({ page }) => {
  updatedProfileName = `Test Profile ${Date.now()}`;
  const nameInput = page.getByTestId('profile-edit-name')
    .or(page.getByLabel(/name|profile name/i));
  await nameInput.first().clear();
  await nameInput.first().fill(updatedProfileName);
});

When('I save profile edits', async ({ page }) => {
  const saveBtn = page.getByTestId('profile-edit-save')
    .or(page.getByRole('button', { name: /save/i }));
  await saveBtn.first().click();
  await page.waitForTimeout(500);
});

Then('the updated profile name should appear in the list', async ({ page }) => {
  if (!updatedProfileName) return;
  const profileCard = page.locator('[data-testid="profile-card"]').filter({ hasText: updatedProfileName });
  await expect(profileCard).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I click the add profile button', async ({ page }) => {
  // Wait for profiles page to be ready
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(0);

  const addBtn = page.getByRole('button', { name: /add/i })
    .or(page.getByTestId('add-profile-button'));
  await addBtn.first().click();
  await page.waitForTimeout(300);
});

Then('I should see the profile form', async ({ page }) => {
  // The add profile page shows an "Add New Profile" heading and a form
  // It may be a dialog or a full page depending on the route
  const form = page.getByText(/Add New Profile/i)
    .or(page.getByTestId('profile-edit-dialog'))
    .or(page.getByRole('dialog'));
  await expect(form.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I fill in new profile connection details', async ({ page }) => {
  // The add profile page has: Profile Name, Server URL, Username, Password.
  // Saving only actually creates a profile once discoverUrls()/login() succeed
  // against a real server (src/pages/ProfileForm.tsx handleSubmit), so this
  // must point at the real, reachable test server - a made-up host makes the
  // "Add" submit fail validation/connection and no profile is ever created.
  const { host, username, password } = testConfig.server;

  const nameInput = page.getByTestId('setup-profile-name');
  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    newProfileName = `New Profile ${Date.now()}`;
    await nameInput.fill(newProfileName);
  }

  const urlInput = page.getByTestId('setup-portal-url');
  if (await urlInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await urlInput.fill(host);
  }

  // Username and password must both be set or both left blank - a lone
  // username throws "credentials_incomplete" and blocks profile creation.
  if (username && password) {
    const usernameInput = page.getByTestId('setup-username');
    if (await usernameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await usernameInput.fill(username);
    }
    const passwordInput = page.getByTestId('setup-password');
    if (await passwordInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await passwordInput.fill(password);
    }
  }
});

When('I save the new profile', async ({ page }) => {
  // The add profile page has an "Add" button
  const saveBtn = page.getByRole('button', { name: /^add$/i })
    .or(page.getByRole('button', { name: /save|connect/i }));
  // The button may be disabled if required fields are not filled
  if (await saveBtn.first().isEnabled({ timeout: 1000 }).catch(() => false)) {
    await saveBtn.first().click();
    // Saving discovers URLs (trying multiple candidate API paths) and logs in
    // against the real server before the profile is created, then waits 1s
    // before navigating - this can take several seconds. Wait for that full
    // round-trip; a validation error leaves us on this page with no nav, which
    // the assertion step below correctly still fails on.
    await page.waitForURL((url) => !url.pathname.includes('/profiles/new'), {
      timeout: testConfig.timeouts.pageLoad,
    }).catch(() => {
      // Some flows (e.g. dialog-based add, or a validation/connection error)
      // don't navigate; the assertion step below is the real source of truth.
    });
  } else {
    // If button is disabled, the form has validation errors - that's OK for test
    log.info('E2E: Add profile button is disabled (validation)', { component: 'e2e' });
  }
});

Then('I should see the new profile in the list', async ({ page }) => {
  // IMPORTANT: do not click "Cancel" here to "get back to the list" if no
  // card is visible yet. On this page "Cancel" is wired to abort an in-flight
  // discovery/login request (src/pages/ProfileForm.tsx handleCancelDiscovery)
  // whenever the previous step's waitForURL timed out because the real
  // network round-trip was still running - clicking it does not navigate,
  // it silently kills the profile creation that was about to succeed. Just
  // wait for the real outcome instead.
  //
  // The new profile must actually be present by name, not just "some card
  // exists" - the latter is already true from the pre-existing default
  // profile and would pass even if the add silently failed.
  if (newProfileName) {
    await expect(
      page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName })
    ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
    return;
  }
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(1);
});

// Delete-profile scenarios (refs #217): profiles are local connection config,
// not data on the ZM server, so creating and deleting a throwaway one here is
// safe and lets these scenarios exercise a real delete/cancel instead of a
// dialog that can never even open (the delete button only renders once a
// second profile exists - see src/pages/Profiles.tsx `profiles.length > 1`).
Then('the newly added profile should appear in the list', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await expect(card).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

When('I open the delete dialog for the newly added profile', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  const deleteButton = card.locator('[data-testid^="profile-delete-button-"]');
  await deleteButton.click();
});

When('I confirm profile deletion', async ({ page }) => {
  await page.getByTestId('profile-delete-confirm').click();
});

Then('the newly added profile should no longer appear in the list', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await expect(card).toHaveCount(0, { timeout: testConfig.timeouts.pageLoad });
});

Then('the newly added profile should still appear in the list', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await expect(card).toBeVisible({ timeout: testConfig.timeouts.element });
});
