import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getEventCount } from '../helpers/zm-api';
import { EVENT_FRAME_THUMB_WIDTH } from '../../src/lib/zmninja-ng-constants';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Collapsed lists must not fetch event thumbnails (refs #331).
//
// This matters beyond wasted bandwidth: the first fid in the fallback chain is
// `alarm`, and an event with no alarm frame answers 404 before the chain falls
// through to `snapshot`. A reporter's reverse proxy read that stream of 404s as
// an attack and banned them. So the outcome worth asserting is the request
// itself, not whether a thumbnail element is on screen.
//
// URLs are decoded first: in dev the real URL is nested percent-encoded inside
// the image proxy, the same way the analysis-frame steps handle it (refs #328).
const listenerPages = new WeakSet<Page>();
let thumbnailUrls: string[] = [];

/** Only the carousel asks for a width, so this tells its frames apart from the
 *  video poster, which requests the same view with no size. */
const CAROUSEL_THUMB = `width=${EVENT_FRAME_THUMB_WIDTH}`;

function attachThumbnailCapture(page: Page): void {
  if (listenerPages.has(page)) return;
  listenerPages.add(page);
  page.on('request', (req) => {
    const url = decodeURIComponent(req.url());
    if (url.includes('view=image') && url.includes('eid=')) thumbnailUrls.push(url);
  });
}

When('I start recording event thumbnail requests', async ({ page }) => {
  attachThumbnailCapture(page);
  thumbnailUrls = [];
});

/**
 * Waits for a thumbnail response rather than asserting straight away.
 *
 * Asserting immediately after the reload passes for the wrong reason: the list
 * renders its thumbnails only once the events query resolves, so an assertion
 * that runs first sees an empty array whether or not the list is collapsed.
 * Verified by re-rendering the collapsed body with `display: none` and enabling
 * its query, a change that does fetch every thumbnail; the immediate assertion
 * still passed. Waiting for the response the regression would produce is what
 * makes the empty case mean something.
 */
When('I give the app its chance to fetch thumbnails', async ({ page }) => {
  await page
    .waitForResponse((res) => decodeURIComponent(res.url()).includes('view=image'), {
      timeout: testConfig.timeouts.element,
    })
    .catch(() => { /* nothing came, which is the outcome the next step asserts */ });
});

Then('no event thumbnails should have been requested', async () => {
  expect(
    thumbnailUrls,
    'a collapsed list fetched event thumbnails, which is what gets users IP-banned'
  ).toEqual([]);
});

// Runs after the list is expanded again. It doubles as proof the recorder above
// actually sees these requests, so the empty assertion cannot pass vacuously.
Then('event thumbnails should be requested', async () => {
  await expect
    .poll(() => thumbnailUrls.length, { timeout: testConfig.timeouts.element })
    .toBeGreaterThan(0);
  log.info('E2E recorded event thumbnail requests', {
    component: 'e2e',
    count: thumbnailUrls.length,
  });
});

Then('no event frame thumbnails should have been requested', async () => {
  expect(
    thumbnailUrls.filter((url) => url.includes(CAROUSEL_THUMB)),
    'a collapsed frame carousel fetched its frames'
  ).toEqual([]);
});

Then('event frame thumbnails should be requested', async () => {
  await expect
    .poll(() => thumbnailUrls.filter((url) => url.includes(CAROUSEL_THUMB)).length, {
      timeout: testConfig.timeouts.element,
    })
    .toBeGreaterThan(0);
});

When('I toggle the event frames carousel', async ({ page }) => {
  if ((await getEventCount()) === 0) return;
  await page.getByTestId('event-frames-card-toggle').click();
});

Then('the event frames carousel should be collapsed', async ({ page }) => {
  if ((await getEventCount()) === 0) return;
  await expect(page.getByTestId('event-frames-card-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
    { timeout: testConfig.timeouts.element }
  );
});
