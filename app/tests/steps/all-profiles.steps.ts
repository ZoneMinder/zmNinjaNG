import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

/**
 * Asserts the event list has stopped changing before a step counts cards.
 *
 * The events query can resolve into more than one render pass (a cached
 * page, then the network response), so a bare "count > 0" check can fire on
 * a partial render - exactly what made the merged-events scenario flaky:
 * the single-profile capture and the All-mode read each grabbed a card
 * count mid-fetch instead of the settled one. Polls the card count until it
 * reads the SAME non-zero value twice in a row (each read spaced by
 * expect.poll's own retry interval - no waitForTimeout, per repo rule).
 */
async function assertEventListSettled(page: Page): Promise<void> {
  const eventCards = page.getByTestId('event-card');
  let lastCount = -1;
  let stableReads = 0;
  await expect.poll(async () => {
    const count = await eventCards.count();
    stableReads = count > 0 && count === lastCount ? stableReads + 1 : 0;
    lastCount = count;
    return stableReads >= 2;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
}

// Captured on the single-profile Monitors view before switching to All mode,
// so the aggregation scenario can assert an outcome (2x) instead of a
// hardcoded count. Module-scoped like the other step files' scenario state
// (see profiles.steps.ts); each scenario re-runs the Background, so no
// cross-scenario carryover is relied on here.
let singleProfileMonitorCount = 0;
// Same pattern as singleProfileMonitorCount above, for the merged-events
// scenario. Captured on the single-profile Events view before switching to
// All mode.
let singleProfileEventCount = 0;

When('I add a second profile named {string} pointing at the same server', async ({ page }, name: string) => {
  await page.getByTestId('profiles-add-button').click();
  await expect(page.getByTestId('setup-profile-name')).toBeVisible({ timeout: testConfig.timeouts.element });
  await page.getByTestId('setup-profile-name').fill(name);

  // Point at the SAME real test server as the profile created by the login
  // step - this is what makes "All mode aggregates N profiles" observable
  // without a second real ZM instance.
  const { host, username, password } = testConfig.server;
  const portalInput = page.getByTestId('setup-portal-url');
  await portalInput.clear();
  await portalInput.fill(host);
  if (username) await page.getByTestId('setup-username').fill(username);
  if (password) await page.getByTestId('setup-password').fill(password);

  await page.getByTestId('connect-button').click();
  // Discovery + login against the real server, then a 1s delay before nav
  // back to the page that opened this form (ProfileForm.tsx handleSubmit).
  await page.waitForURL((url) => !url.pathname.includes('/profiles/new'), {
    timeout: testConfig.timeouts.pageLoad,
  }).catch(() => {
    // The assertion below is the real source of truth if navigation didn't fire.
  });
  await expect(page.locator('[data-testid="profile-card"]').filter({ hasText: name })).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
});

When('I add a profile named {string} with an unreachable server', async ({ page }, name: string) => {
  await page.getByTestId('profiles-add-button').click();
  await expect(page.getByTestId('setup-profile-name')).toBeVisible({ timeout: testConfig.timeouts.element });
  await page.getByTestId('setup-profile-name').fill(name);

  // Manual URL entry with no credentials skips both discoverUrls() and the
  // login call in ProfileForm.handleTestConnection, so the "Add" click below
  // never actually probes this host - the profile saves immediately even
  // though nothing is listening on it. The automatic post-add profile
  // switch that follows swallows every bootstrap network error internally
  // (src/services/profile-bootstrap.ts catches per-step), so it never blocks
  // the return navigation either. This is the only UI path that can create
  // an unreachable profile without a real second server.
  const unreachable = 'http://127.0.0.1:9';
  await page.getByTestId('setup-portal-url').fill(unreachable);
  await page.getByTestId('setup-manual-urls-toggle').click();
  await page.getByTestId('setup-api-url').fill(`${unreachable}/api`);
  await page.getByTestId('setup-cgi-url').fill(`${unreachable}/cgi-bin`);

  await page.getByTestId('connect-button').click();
  await page.waitForURL((url) => !url.pathname.includes('/profiles/new'), {
    timeout: testConfig.timeouts.pageLoad,
  }).catch(() => {
    // The assertion below is the real source of truth if navigation didn't fire.
  });
  await expect(page.locator('[data-testid="profile-card"]').filter({ hasText: name })).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
});

Then('I record the single-profile monitor card count', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  singleProfileMonitorCount = await page.getByTestId('monitor-card').count();
});

Then('I should see the All Servers profile card', async ({ page }) => {
  await expect(page.getByTestId('profile-card-all')).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I click the All Servers profile card', async ({ page }) => {
  await page.getByTestId('profile-card-all').click();
});

Then('I should be on the monitors page', async ({ page }) => {
  await expect(page).toHaveURL(/\/monitors$/, { timeout: testConfig.timeouts.transition });
});

Then('I should see a monitor profile chip on every monitor card', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const cardCount = await page.getByTestId('monitor-card').count();
  const chipCount = await page.getByTestId('monitor-profile-chip').count();
  expect(chipCount).toBe(cardCount);
});

Then('the monitor card count should be double the recorded single-profile count', async ({ page }) => {
  expect(singleProfileMonitorCount).toBeGreaterThan(0);
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileMonitorCount * 2);
});

Then('I should see a profile error strip for {string}', async ({ page }, name: string) => {
  await expect(
    page.locator('[data-testid^="profile-error-strip-"]').filter({ hasText: name })
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('I should see monitor cards from the healthy profiles', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
});

Then('I record the single-profile event card count', async ({ page }) => {
  await assertEventListSettled(page);
  singleProfileEventCount = await page.getByTestId('event-card').count();
});

Then('I should see an event profile chip on every event card', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('event-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const cardCount = await page.getByTestId('event-card').count();
  const chipCount = await page.getByTestId('event-profile-chip').count();
  expect(chipCount).toBe(cardCount);
});

// Both Background profiles point at the same real server, so the merged list
// is exactly 2x in principle - but unlike the monitors scenario's static
// count, live event counts can drift between the single-profile capture
// above and this aggregate read (a new motion event recorded server-side in
// between). Asserting >= keeps the outcome real (aggregation actually ran,
// chips present) without flaking on that drift. The count alone can't catch
// a broken aggregation that silently returns only one profile's events (that
// still satisfies >=): also require at least 2 DISTINCT profile-chip texts,
// so both Background profiles are provably represented (refs #337 I11).
Then('the event card count should be at least the recorded single-profile count', async ({ page }) => {
  expect(singleProfileEventCount).toBeGreaterThan(0);
  await assertEventListSettled(page);
  await expect.poll(async () => page.getByTestId('event-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThanOrEqual(singleProfileEventCount);

  const chipTexts = await page.getByTestId('event-profile-chip').allTextContents();
  expect(new Set(chipTexts).size).toBeGreaterThanOrEqual(2);
});

When('I click a monitor card', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-player').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  await page.getByTestId('monitor-player').first().click();
});

Then('the URL should match the all-mode monitor detail route', async ({ page }) => {
  await expect(page).toHaveURL(/\/all\/monitors\/[^/]+\/[^/]+$/, { timeout: testConfig.timeouts.transition });
});

Then('the profile switcher should still show All Servers', async ({ page }) => {
  await expect(page.getByTestId('profile-switcher-trigger')).toHaveText(/All Servers/, {
    timeout: testConfig.timeouts.element,
  });
});
