/**
 * Steps for named groups of servers (virtual profiles, refs #337).
 *
 * The suite's two profiles point at the SAME ZoneMinder server, so "this
 * group aggregates only its member" cannot be proved by comparing monitor
 * names. What proves it is the per-card server chip: in a one-member group
 * every chip names that member, and the card count stays at one server's
 * worth instead of doubling.
 */
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

const GROUP_CARD = '[data-testid^="profile-card-virtual-"]';

When(
  'I create a group named {string} holding only the {string} profile',
  async ({ page }, groupName: string, memberName: string) => {
    await page.getByTestId('profile-new-group-button').click();
    await expect(page.getByTestId('virtual-profile-dialog')).toBeVisible({
      timeout: testConfig.timeouts.element,
    });
    await page.getByTestId('virtual-profile-name').fill(groupName);

    const memberRow = page
      .locator('[data-testid^="virtual-profile-member-row-"]')
      .filter({ hasText: memberName });
    await memberRow.getByRole('checkbox').click();

    await page.getByTestId('virtual-profile-save').click();
    await expect(page.getByTestId('virtual-profile-dialog')).toHaveCount(0, {
      timeout: testConfig.timeouts.element,
    });
  }
);

Then('I should see the group card for {string}', async ({ page }, name: string) => {
  await expect(page.locator(GROUP_CARD).filter({ hasText: name })).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

Then('I should not see the group card for {string}', async ({ page }, name: string) => {
  await expect(page.locator(GROUP_CARD).filter({ hasText: name })).toHaveCount(0, {
    timeout: testConfig.timeouts.element,
  });
});

When('I click the group card for {string}', async ({ page }, name: string) => {
  await page.locator(GROUP_CARD).filter({ hasText: name }).click();
});

When('I delete the group named {string}', async ({ page }, name: string) => {
  const card = page.locator(GROUP_CARD).filter({ hasText: name });
  await card.locator('[data-testid^="profile-virtual-delete-"]').click();
  // The confirmation has to promise the member servers survive; the step
  // below asserts they do.
  await expect(page.getByTestId('profile-virtual-delete-dialog')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
  await page.getByTestId('profile-virtual-delete-confirm').click();
});

Then('I should see the {string} profile card', async ({ page }, name: string) => {
  await expect(page.locator('[data-testid="profile-card"]').filter({ hasText: name })).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

/**
 * The discriminator for member-scoped aggregation: with the group holding one
 * of the two profiles, every chip on the page has to name that one. A group
 * that silently fell back to All mode would put the other profile's name on
 * half of them.
 */
Then('every monitor profile chip should name {string}', async ({ page }, name: string) => {
  const chips = page.getByTestId('monitor-profile-chip');
  await expect.poll(async () => chips.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const cards = await page.getByTestId('monitor-card').count();
  expect(await chips.count()).toBe(cards);
  expect(await chips.allInnerTexts()).toEqual(Array(cards).fill(name));
});

// Same select the All Servers steps drive - it belongs to whichever aggregate
// is current, which is the whole point of these assertions.
const STREAMING_SELECT = 'all-mode-streaming-select';

Then('the aggregate streaming mode should be named for {string}', async ({ page }, name: string) => {
  await expect(page.getByTestId(STREAMING_SELECT)).toHaveAttribute(
    'aria-label',
    new RegExp(name),
    { timeout: testConfig.timeouts.element }
  );
});

When('I set the aggregate streaming mode to {string}', async ({ page }, label: string) => {
  await page.getByTestId(STREAMING_SELECT).click();
  const option = page.getByTestId(`all-mode-streaming-option-${label.toLowerCase().replace(/ /g, '-')}`);
  await expect(option).toBeVisible({ timeout: testConfig.timeouts.element });
  await option.click();
});

Then('the aggregate streaming mode should be {string}', async ({ page }, label: string) => {
  await expect(page.getByTestId(STREAMING_SELECT)).toContainText(label, {
    timeout: testConfig.timeouts.element,
  });
});
