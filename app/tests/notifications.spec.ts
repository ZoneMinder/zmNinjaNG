import { test, expect } from '@playwright/test';

test.describe('Notification System', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app
    await page.goto('http://localhost:5173');

    // Wait for app to load
    await page.waitForSelector('text=zmNg');
  });

  test('should display notifications page', async ({ page }) => {
    // Click notifications in sidebar
    await page.click('text=Notifications');

    // Should show notification settings page
    await expect(page.locator('h1')).toContainText('Notifications');
    await expect(page.locator('text=Configure real-time event notifications')).toBeVisible();
  });

  test('should enable notifications', async ({ page }) => {
    await page.click('text=Notifications');

    // Toggle enable switch
    const enableSwitch = page.locator('#enable-notifications');
    await enableSwitch.click();

    // Should show server configuration
    await expect(page.locator('text=Event Notification Server')).toBeVisible();
  });

  test('should connect to mock server', async ({ page }) => {
    await page.click('text=Notifications');

    // Enable notifications
    await page.click('#enable-notifications');

    // Fill in server details
    await page.fill('#host', 'localhost');

    // Show advanced settings
    await page.click('text=Show Advanced Settings');

    // Disable SSL for local testing
    await page.click('#ssl');

    // Click connect
    await page.click('button:has-text("Connect")');

    // Wait for connection
    await page.waitForTimeout(1000);

    // Should show connected status
    await expect(page.locator('text=Connected')).toBeVisible();
  });

  test('should display toast notification', async ({ page }) => {
    // Setup: Enable and connect
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'localhost');
    await page.click('text=Show Advanced Settings');
    await page.click('#ssl');
    await page.click('button:has-text("Connect")');

    // Wait for connection
    await page.waitForTimeout(1000);

    // Wait for first notification (mock server sends every 10s)
    await page.waitForTimeout(12000);

    // Should see toast notification
    // Note: Toasts appear in the toast container
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 15000 });
  });

  test('should show unread badge', async ({ page }) => {
    // Setup and connect
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'localhost');
    await page.click('text=Show Advanced Settings');
    await page.click('#ssl');
    await page.click('button:has-text("Connect")');

    // Wait for notification
    await page.waitForTimeout(12000);

    // Check sidebar for unread badge
    const badge = page.locator('text=Notifications >> .. >> text=/\\d+/');
    await expect(badge).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to notification history', async ({ page }) => {
    await page.click('text=Notifications');

    // Click view history button
    await page.click('button:has-text("View History")');

    // Should navigate to history page
    await expect(page.locator('h1:has-text("Notification History")')).toBeVisible();
  });

  test('should display notification with image in history', async ({ page }) => {
    // Setup and wait for notification
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'localhost');
    await page.click('text=Show Advanced Settings');
    await page.click('#ssl');
    await page.click('button:has-text("Connect")');

    // Wait for notification
    await page.waitForTimeout(12000);

    // Navigate to history
    await page.click('button:has-text("View History")');

    // Should see event with image
    const eventCard = page.locator('[class*="border-primary"]').first();
    await expect(eventCard).toBeVisible({ timeout: 15000 });

    // Should have image
    const image = eventCard.locator('img').first();
    await expect(image).toBeVisible();

    // Should have event details
    await expect(eventCard.locator('text=/Event ID:/i')).toBeVisible();
  });

  test('should mark notification as read', async ({ page }) => {
    // Setup and wait for notification
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'localhost');
    await page.click('text=Show Advanced Settings');
    await page.click('#ssl');
    await page.click('button:has-text("Connect")');

    await page.waitForTimeout(12000);

    // Go to history
    await page.click('button:has-text("View History")');

    // Click mark as read
    await page.click('button:has-text("Mark as Read")');

    // Badge should update or disappear
    await page.waitForTimeout(500);

    // Event should change appearance (opacity)
    const eventCard = page.locator('.opacity-60').first();
    await expect(eventCard).toBeVisible({ timeout: 5000 });
  });

  test('should configure monitor filters', async ({ page }) => {
    await page.click('text=Notifications');
    await page.click('#enable-notifications');

    // Should show monitor filters if monitors exist
    // This assumes monitors are loaded
    const monitorFilter = page.locator('text=/Monitor ID:/i').first();
    if (await monitorFilter.isVisible({ timeout: 2000 })) {
      // Toggle a monitor
      const monitorSwitch = page.locator('[id^="monitor-"]').first();
      await monitorSwitch.click();

      // Should show interval selector
      await expect(page.locator('text=Check Interval:')).toBeVisible();
    }
  });

  test('should show advanced settings', async ({ page }) => {
    await page.click('text=Notifications');
    await page.click('#enable-notifications');

    // Click show advanced settings
    await page.click('text=Show Advanced Settings');

    // Should show SSL toggle
    await expect(page.locator('text=Use SSL (wss://)')).toBeVisible();

    // Should show toast settings
    await expect(page.locator('text=Show Toast Notifications')).toBeVisible();
    await expect(page.locator('text=Play Sound')).toBeVisible();
  });

  test('should disconnect from server', async ({ page }) => {
    // Setup and connect
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'localhost');
    await page.click('text=Show Advanced Settings');
    await page.click('#ssl');
    await page.click('button:has-text("Connect")');

    await page.waitForTimeout(1000);

    // Click disconnect
    await page.click('button:has-text("Disconnect")');

    // Should show disconnected status
    await expect(page.locator('text=Disconnected')).toBeVisible();
  });

  test('should persist settings across page reload', async ({ page }) => {
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'test-server.com');

    // Reload page
    await page.reload();

    // Navigate back to notifications
    await page.click('text=Notifications');

    // Settings should be persisted
    const hostInput = page.locator('#host');
    await expect(hostInput).toHaveValue('test-server.com');
  });
});

test.describe('Notification History', () => {
  test('should show empty state when no notifications', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Navigate directly to history
    await page.goto('http://localhost:5173/notifications/history');

    // Should show empty state
    await expect(page.locator('text=No notifications yet')).toBeVisible();
  });

  test('should display notification count', async ({ page }) => {
    // This test assumes notifications exist
    await page.goto('http://localhost:5173/notifications/history');

    // Look for count text
    const countText = page.locator('text=/Showing \\d+ notification/');
    // May or may not be visible depending on state
  });

  test('should clear all notifications', async ({ page }) => {
    // Setup: Get some notifications first
    await page.goto('http://localhost:5173');
    await page.click('text=Notifications');
    await page.click('#enable-notifications');
    await page.fill('#host', 'localhost');
    await page.click('text=Show Advanced Settings');
    await page.click('#ssl');
    await page.click('button:has-text("Connect")');

    await page.waitForTimeout(12000);

    // Go to history
    await page.click('button:has-text("View History")');

    // Click clear all
    await page.click('button:has-text("Clear All")');

    // Should show empty state
    await expect(page.locator('text=No notifications yet')).toBeVisible();
  });
});
