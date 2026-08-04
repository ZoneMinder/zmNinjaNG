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

/**
 * Points a newly-created profile at the SAME real test server as the
 * Background's profile - what makes "All mode aggregates N profiles"
 * observable without a second real ZM instance.
 */
async function addProfilePointingAtSameServer(page: Page, name: string): Promise<void> {
  await page.getByTestId('profiles-add-button').click();
  await expect(page.getByTestId('setup-profile-name')).toBeVisible({ timeout: testConfig.timeouts.element });
  await page.getByTestId('setup-profile-name').fill(name);

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
}

When('I add a second profile named {string} pointing at the same server', async ({ page }, name: string) => {
  await addProfilePointingAtSameServer(page, name);
});

// Same helper as the Background's "second profile" step above, under a name
// that reads naturally when a scenario adds a THIRD profile (refs #337).
When('I add a profile named {string} pointing at the same server', async ({ page }, name: string) => {
  await addProfilePointingAtSameServer(page, name);
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

Then('I should not see the All Servers profile card', async ({ page }) => {
  await expect(page.getByTestId('profile-card-all')).toHaveCount(0, { timeout: testConfig.timeouts.element });
});

// refs #337: per-profile disable toggle. Same button drives both directions -
// clicking it again on an already-disabled profile re-enables it.
When('I disable the {string} profile', async ({ page }, name: string) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: name });
  await card.locator('[data-testid^="profile-disable-toggle-"]').click();
  await expect(card.getByTestId('profile-disabled-badge')).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I enable the {string} profile', async ({ page }, name: string) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: name });
  await card.locator('[data-testid^="profile-disable-toggle-"]').click();
  await expect(card.getByTestId('profile-disabled-badge')).toHaveCount(0, { timeout: testConfig.timeouts.element });
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

  // A one-shot snapshot here can fire before the slower of the two
  // profiles' event queries has contributed to the DOM: the total card
  // count settling (above) only means it stopped changing, not that BOTH
  // profiles are represented yet. Polled with its own generous timeout so
  // a late-arriving second profile still gets counted (refs #337 round 3).
  await expect.poll(async () => {
    const chipTexts = await page.getByTestId('event-profile-chip').allTextContents();
    return new Set(chipTexts).size;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(2);
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

// Captured on the single-profile Montage view before switching to All mode,
// same pattern as singleProfileMonitorCount above.
let singleProfileMontageTileCount = 0;

Then('I record the single-profile montage tile count', async ({ page }) => {
  // Excludes the nested montage-monitor-media testid inside each tile, which
  // also matches this prefix (refs #337 round 1 - caught by this scenario).
  const tiles = page.locator('[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])');
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  singleProfileMontageTileCount = await tiles.count();
});

Then('I should see a monitor profile chip on every montage tile', async ({ page }) => {
  // Excludes the nested montage-monitor-media testid inside each tile, which
  // also matches this prefix (refs #337 round 1 - caught by this scenario).
  const tiles = page.locator('[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])');
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const tileCount = await tiles.count();
  const chipCount = await page.getByTestId('montage-profile-chip').count();
  expect(chipCount).toBe(tileCount);
});

Then('the montage tile count should be double the recorded single-profile count', async ({ page }) => {
  expect(singleProfileMontageTileCount).toBeGreaterThan(0);
  // Excludes the nested montage-monitor-media testid inside each tile, which
  // also matches this prefix (refs #337 round 1 - caught by this scenario).
  const tiles = page.locator('[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])');
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileMontageTileCount * 2);
});

// Events montage view, All mode (refs #337 Phase 4 Task 6): the gate that
// used to block montage view in All mode is gone (refs #337 e74d02b4);
// this is a regression check that it stays gone AND that tiles actually
// render (not just an absent-gate false-positive).
Then('event montage tiles should render with no gate notice', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('event-montage-tile').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  await expect(page.getByTestId('events-montage-gate')).toHaveCount(0);
});

// Captured on the single-profile Live Activity view before switching to All
// mode, same pattern as singleProfileMonitorCount above. Alarm states can't
// be forced against the live test server (no e2e hook fires a real motion
// event), so this scenario can only assert page structure and the watched
// COUNT, not that any tile actually renders - the watched count is only
// visible in the all-quiet empty state's "Watching N monitors" copy, so the
// scenario depends on the server being quiet, same as live-activity.feature's
// own all-quiet scenario.
let singleProfileLiveActivityWatchedCount = 0;

async function readLiveActivityWatchedCount(page: Page): Promise<number> {
  const empty = page.getByTestId('live-activity-empty');
  await expect(empty).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  const text = await empty.innerText();
  const match = text.match(/Watching (\d+) monitors?/i);
  expect(match, `expected a "Watching N monitor(s)" count in: ${text}`).not.toBeNull();
  return Number(match![1]);
}

Then('I record the single-profile Live Activity watched count', async ({ page }) => {
  singleProfileLiveActivityWatchedCount = await readLiveActivityWatchedCount(page);
  expect(singleProfileLiveActivityWatchedCount).toBeGreaterThan(0);
});

// The gate that used to block All mode is gone (refs #337, #341, e74d02b4
// precedent): this is a regression check that it stays gone AND that the
// page renders something real (tiles or the quiet state), not just an
// absent-gate false-positive.
Then('Live Activity should render with no gate notice', async ({ page }) => {
  await expect(page.getByTestId('live-activity-all-mode-notice')).toHaveCount(0);
  await expect(
    page.getByTestId('live-activity-empty').or(page.getByTestId('live-activity-tile'))
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('the Live Activity watched count should be double the recorded single-profile count', async ({ page }) => {
  expect(singleProfileLiveActivityWatchedCount).toBeGreaterThan(0);
  await expect.poll(async () => readLiveActivityWatchedCount(page), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileLiveActivityWatchedCount * 2);
});

Then('I should see the page profile picker', async ({ page }) => {
  await expect(page.getByTestId('page-profile-picker')).toBeVisible({ timeout: testConfig.timeouts.element });
});

/**
 * The ZM API takes its session token as a `token=` query param, not a header
 * (see app/src/api/client.ts appendQuery) - reading it back out of the
 * request URL is the one truly per-profile-distinguishable signal available
 * here: both Background profiles point at the SAME real test server, so the
 * fetched log CONTENT is identical between them and can't be diffed. Each
 * profile still logs in independently, so its token differs - proving the
 * query actually refired for the newly-picked profile rather than reusing a
 * stale response.
 */
function extractToken(url: string): string | null {
  return new URL(url).searchParams.get('token');
}

let firstLogsRequestToken: string | null = null;
let secondLogsRequestToken: string | null = null;
let pickedLogsProfileText = '';

When('I switch the Logs page to the ZM server log source', async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().includes('/logs.json'), { timeout: testConfig.timeouts.pageLoad }),
    page.getByTestId('log-source-server').click(),
  ]);
  firstLogsRequestToken = extractToken(response.url());
  await expect(
    page.getByTestId('logs-list').or(page.getByTestId('logs-empty-state'))
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

// Picks whichever picker option ISN'T the currently-displayed profile, so
// this doesn't depend on which of the two Background profiles the page
// happens to default to.
When('I pick a different profile in the Logs page picker', async ({ page }) => {
  const picker = page.getByTestId('page-profile-picker');
  const currentText = (await picker.innerText()).trim();
  await picker.click();
  const options = page.locator('[data-testid^="page-profile-picker-option-"]');
  await expect.poll(async () => options.count(), {
    timeout: testConfig.timeouts.element,
  }).toBeGreaterThan(0);
  const texts = (await options.allTextContents()).map((text) => text.trim());
  const target = texts.find((text) => text !== currentText);
  expect(target).toBeTruthy();
  pickedLogsProfileText = target as string;

  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().includes('/logs.json'), { timeout: testConfig.timeouts.pageLoad }),
    options.filter({ hasText: pickedLogsProfileText }).click(),
  ]);
  secondLogsRequestToken = extractToken(response.url());
});

Then('the Logs page picker should show the newly picked profile', async ({ page }) => {
  expect(pickedLogsProfileText).toBeTruthy();
  await expect(page.getByTestId('page-profile-picker')).toHaveText(pickedLogsProfileText, {
    timeout: testConfig.timeouts.element,
  });
});

Then('the logs query should have refired with a different access token', async () => {
  expect(firstLogsRequestToken).toBeTruthy();
  expect(secondLogsRequestToken).toBeTruthy();
  expect(secondLogsRequestToken).not.toBe(firstLogsRequestToken);
});

Then('I should see a notification overview row for every profile', async ({ page }) => {
  await expect.poll(async () => page.locator('[data-testid^="notification-overview-row-"]').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThanOrEqual(2);
});

// Both Background profiles point at the same real server, so a host or
// query-param diff (the Logs picker's proof-of-switch signal) isn't
// available here - the overview row's own active marker is the strongest
// assertable outcome. Clicks whichever row ISN'T currently marked active.
let clickedOverviewRowTestId = '';

When("I click a different profile's notification overview row", async ({ page }) => {
  const rows = page.locator('[data-testid^="notification-overview-row-"]');
  await expect.poll(async () => rows.count(), { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(2);

  const activeTestId = await page
    .locator('[data-testid^="notification-overview-row-"][aria-current="true"]')
    .getAttribute('data-testid');

  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const testId = await rows.nth(i).getAttribute('data-testid');
    if (testId !== activeTestId) {
      clickedOverviewRowTestId = testId as string;
      await rows.nth(i).click();
      break;
    }
  }
  expect(clickedOverviewRowTestId).toBeTruthy();
});

Then('that row should be marked as the active profile', async ({ page }) => {
  expect(clickedOverviewRowTestId).toBeTruthy();
  await expect(page.getByTestId(clickedOverviewRowTestId)).toHaveAttribute('aria-current', 'true', {
    timeout: testConfig.timeouts.element,
  });
});
