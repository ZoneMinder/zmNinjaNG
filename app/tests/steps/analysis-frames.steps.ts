import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { ZMS_COMMANDS } from '../../src/lib/zm/zm-constants';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Analysis-frame steps
//
// Turning analysis frames on changes what zms encodes into the MJPEG stream,
// which the DOM cannot see: the <img> src never changes, and the overlay only
// appears on frames where a zone alarmed, so asserting on pixels would be
// asserting on whether a camera happened to move. The observable outcome is the
// stream command itself (src/hooks/useAnalysisFrames.ts), recorded the same way
// the PTZ steps record control requests. URLs are decoded first: in dev the
// real URL can be nested percent-encoded inside the image proxy (refs #328).
const analysisListenerPages = new WeakSet<import('@playwright/test').Page>();
let analysisRequestUrls: string[] = [];
/** Whether this server serves the monitor over MJPEG at all. */
let mjpegTransport = false;

function attachAnalysisRequestCapture(page: import('@playwright/test').Page): void {
  if (analysisListenerPages.has(page)) return;
  analysisListenerPages.add(page);
  page.on('request', (req) => {
    const url = decodeURIComponent(req.url());
    if (url.includes('request=stream') && url.includes('command=')) {
      analysisRequestUrls.push(url);
    }
  });
}

const sentCommand = (command: number) =>
  analysisRequestUrls.some((url) => url.includes(`command=${command}`));

/** Distinct connkeys a command was sent for, i.e. distinct nph-zms processes. */
const connKeysCommanded = (command: number): Set<string> => {
  const keys = new Set<string>();
  for (const url of analysisRequestUrls) {
    if (!url.includes(`command=${command}`)) continue;
    const connkey = /[?&]connkey=(\d+)/.exec(url)?.[1];
    if (connkey) keys.add(connkey);
  }
  return keys;
};

async function clickAnalysisToggle(page: import('@playwright/test').Page): Promise<void> {
  attachAnalysisRequestCapture(page);
  analysisRequestUrls = [];
  // The command only exists on an MJPEG stream; a go2rtc/WebRTC feed has no
  // command socket. Transport, not the control under test, so the toggle's own
  // assertions below still run either way. Attachment, not visibility: the
  // element is mounted for the whole connection but only paints once a frame
  // has arrived (refs #352), so a visibility probe would read "no MJPEG" purely
  // because it ran during the connect.
  mjpegTransport = (await page.getByTestId('video-player-mjpeg').count()) > 0;
  if (!mjpegTransport) {
    log.info('E2E: monitor is not served over MJPEG, skipping stream-command assertions', {
      component: 'e2e',
    });
  }
  await openViewOptions(page);
  const toggle = page.getByTestId('analysis-frames-toggle');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  // The item keeps the menu open, so close it before anything asserts on the
  // page underneath.
  await page.keyboard.press('Escape');
}

When('I turn analysis frames on', async ({ page }) => {
  await clickAnalysisToggle(page);
});

When('I turn analysis frames off', async ({ page }) => {
  await clickAnalysisToggle(page);
});

Then('the analysis-on command should be sent for the live stream', async () => {
  if (!mjpegTransport) return;
  await expect.poll(() => sentCommand(ZMS_COMMANDS.cmdAnalyzeOn), {
    timeout: testConfig.timeouts.transition,
  }).toBeTruthy();
});

Then('the analysis-off command should be sent for the live stream', async () => {
  if (!mjpegTransport) return;
  await expect.poll(() => sentCommand(ZMS_COMMANDS.cmdAnalyzeOff), {
    timeout: testConfig.timeouts.transition,
  }).toBeTruthy();
});

Then('the analysis-on command should be re-sent for the new stream', async ({ page }) => {
  if (!mjpegTransport) return;
  // The remembered setting has to reach the fresh nph-zms process this
  // navigation minted; that process starts on normal frames whatever the
  // previous one was told. Asserting a second, different connkey rather than
  // "a request happened" stops the first stream's recorded command from
  // satisfying this on its own.
  attachAnalysisRequestCapture(page);
  await expect.poll(() => connKeysCommanded(ZMS_COMMANDS.cmdAnalyzeOn).size, {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(1);
});

Then('the analysis frames toggle should be active', async ({ page }) => {
  await openViewOptions(page);
  await expect(page.getByTestId('analysis-frames-toggle')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
});

Then('the analysis frames toggle should be inactive', async ({ page }) => {
  await openViewOptions(page);
  await expect(page.getByTestId('analysis-frames-toggle')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
});

/**
 * Analysis frames moved into each screen's view-options menu. Opened from the
 * keyboard: Radix leaves a dismissable layer over the page for a beat after a
 * menu closes, so a click in that window never reaches the trigger.
 */
async function openViewOptions(page: Page) {
  const trigger = page.locator('[data-testid$="-menu"]').first();
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByTestId('analysis-frames-toggle')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
}
