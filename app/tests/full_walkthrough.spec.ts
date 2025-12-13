import { test, expect, Page, BrowserContext } from '@playwright/test';
import { testConfig } from './helpers/config';

/**
 * Full Walkthrough Test (Serial)
 * 
 * Runs exhaustive E2E tests in sequence using a shared browser context.
 * This allows each step (Auth, Dashboard, Navigation) to appear as a separate
 * test in the report, while maintaining the state/session across them.
 */
test.describe.serial('Full App Walkthrough', () => {
    let page: Page;
    let context: BrowserContext;

    test.beforeAll(async ({ browser }) => {
        context = await browser.newContext();
        page = await context.newPage();

        // --- STEP 1: AUTHENTICATION (Setup) ---
        const { host, username, password } = testConfig.server;
        console.log('Navigating to root...');
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.waitForURL(/.*(setup|dashboard|monitors)/, { timeout: testConfig.timeouts.transition });

        if (page.url().includes('/setup')) {
            console.log('On Setup page. Logging in...');
            await page.getByLabel(/server url/i).fill(host);
            if (username) await page.getByLabel(/username/i).fill(username);
            if (password) await page.getByLabel(/password/i).fill(password);

            const connectBtn = page.getByRole('button', { name: /(connect|save|login)/i });
            await expect(connectBtn).toBeEnabled();
            await connectBtn.click();

            await page.waitForURL(/.*(dashboard|monitors)/, { timeout: testConfig.timeouts.transition });
            console.log('Login successful.');
        } else {
            console.log('Already logged in.');
        }
    });

    test.afterAll(async () => {
        await context.close();
    });

    // --- STEP 2: DASHBOARD & WIDGETS ---
    test('Dashboard: Add Widget', async () => {
        // Navigate to Dashboard explicitly to be sure
        await page.getByRole('link', { name: /^Dashboard$/i }).click();
        await page.waitForURL(/.*dashboard/);

        // Open Add Widget dialog
        console.log('Opening Add Widget dialog...');

        // Debug: print all buttons if failing to find 'Add Widget' or '+'
        // But let's try the icon or title approach if button text varies
        const addWidgetBtn = page.getByRole('button', { name: /add widget/i }).first();
        if (await addWidgetBtn.isVisible()) {
            await addWidgetBtn.click();
        } else {
            // Fallback: maybe just an icon? In Dashboard.tsx it has title="Add Widget" (?) No, title is in translation?
            // Actually, verify if it's visible. If clean setup, it should be.
            // If this fails, we might need a more robust selector.
            await page.getByTitle(/Add Widget|Add/i).click();
        }

        const dialog = page.getByRole('dialog', { name: /add widget/i });
        await expect(dialog).toBeVisible();

        console.log('Selecting Timeline widget...');
        // Select 'Timeline' type using card class to be specific
        const timelineOption = page.locator('div.border.rounded-lg').filter({ hasText: /^Timeline$/ }).first();
        await timelineOption.click();

        // Verify selection
        await expect(timelineOption).toHaveClass(/border-primary/);

        // Enter title
        const widgetTitle = `Test Timeline ${Date.now()}`;
        await page.getByLabel(/widget title/i).fill(widgetTitle);

        // Click Add 
        // Note: previous run showed multiple "Add" buttons, we use last() or specific containment
        // The dialog "Add" button is likely inside the dialog content.
        const addBtn = dialog.getByRole('button', { name: /Add/i });
        await expect(addBtn).toBeVisible();
        await expect(addBtn).toBeEnabled();
        await addBtn.click();

        // Verify result
        await expect(dialog).not.toBeVisible();
        console.log(`Verifying widget "${widgetTitle}" exists...`);
        await expect(page.locator('.react-grid-item').filter({ hasText: widgetTitle })).toBeVisible({ timeout: testConfig.timeouts.element });
    });

    // --- STEP 3: SIDEBAR NAVIGATION (Individual Tests) ---

    // Helper to perform navigation
    const checkNavigation = async (name: string | RegExp, urlPattern: RegExp, headerName?: string | RegExp) => {
        console.log(`Navigating to ${name}...`);
        await page.getByRole('link', { name: name }).click();
        await page.waitForURL(urlPattern, { timeout: testConfig.timeouts.transition });

        if (headerName) {
            // Some pages might not have h1 matching the sidebar name exactly, using loose regex
            await expect(page.getByRole('heading', { name: headerName })).toBeVisible();
        }
    };

    test('Navigate: Monitors', async () => {
        await checkNavigation(/^Monitors$/i, /.*monitors/, /monitor/i);
    });

    test('Navigate: Montage', async () => {
        await checkNavigation(/^Montage$/i, /.*montage/, /montage/i);
    });

    test('Navigate: Events', async () => {
        await checkNavigation(/^Events$/i, /.*events/, /events/i);
    });

    test('Navigate: Event Montage', async () => {
        await checkNavigation(/^Event Montage$/i, /.*event-montage/, /event montage/i);
    });

    test('Navigate: Timeline', async () => {
        await checkNavigation(/^Timeline$/i, /.*timeline/, /timeline/i);
    });

    test('Navigate: Notifications', async () => {
        // Special handling for Notifications badge
        console.log('Navigating to Notifications...');
        const link = page.getByRole('link', { name: /^Notifications/i }); // loose match for badge
        await link.click();
        await page.waitForURL(/.*notifications/, { timeout: testConfig.timeouts.transition });

        // Just verify page load as requested
        // Just verify page load as requested
        // Check for any heading related to notifications
        await expect(page.getByRole('heading', { name: /notification/i })).toBeVisible();
        // Or check specifically for "Notification History" which is the title in the code
        // await expect(page.getByText(/Notification History/i)).toBeVisible();
    });

    test('Navigate: Profiles', async () => {
        await checkNavigation(/^Profiles$/i, /.*profiles/, /profiles/i);
    });

    test('Navigate: Settings', async () => {
        await checkNavigation(/^Settings$/i, /.*settings/, /settings/i);
    });

    test('Navigate: Server', async () => {
        await checkNavigation(/^Server$/i, /.*server/, /server/i);
    });

    test('Navigate: Logs', async () => {
        await checkNavigation(/^Logs$/i, /.*logs/, /logs/i);
    });

});
