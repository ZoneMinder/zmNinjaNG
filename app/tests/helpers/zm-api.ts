/**
 * Direct ZoneMinder API access for e2e tests.
 *
 * Used when a test needs to know a server-side fact (e.g. a monitor's
 * `Controllable` capability) independently of the app UI, so that a UI
 * regression cannot make the test believe the fact is something it isn't.
 * See ptz.steps.ts "the current monitor supports PTZ" (refs #217, #218).
 *
 * This talks to the ZM API directly with node's built-in fetch, using the
 * same login flow as src/api/auth.ts (POST /host/login.json form-encoded,
 * token passed as a query param on subsequent requests). It intentionally
 * does not reuse the app's ApiClient: that client is wired to the browser's
 * auth store, which this Node-side test code does not have access to.
 */
import { testConfig } from './config';

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const { host, username, password } = testConfig.server;
  const body = new URLSearchParams();
  body.set('user', username);
  body.set('pass', password);

  const res = await fetch(`${host}/api/host/login.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`ZM API login failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token?: string; access_token_expires?: number };
  if (!data.access_token) {
    throw new Error('ZM API login response did not include access_token');
  }

  cachedToken = {
    token: data.access_token,
    // Refresh a little early so a long-running suite never races expiry.
    expiresAt: Date.now() + (data.access_token_expires ?? 3600) * 1000 - 30_000,
  };
  return cachedToken.token;
}

/**
 * Query the ZoneMinder API for a monitor's `Controllable` field.
 *
 * This is the ground truth for "does this monitor support PTZ" - independent
 * of whether the app's PTZ panel happens to render, so a rendering regression
 * fails the calling test's assertions instead of being silently skipped.
 */
export async function isMonitorControllable(monitorId: string): Promise<boolean> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/monitors/${monitorId}.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API monitor fetch failed for id ${monitorId}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { monitor?: { Monitor?: { Controllable?: string | number } } };
  const controllable = data.monitor?.Monitor?.Controllable;
  return controllable === '1' || controllable === 1;
}

/**
 * How many monitors the server has.
 *
 * Multi-column layout assertions need to know whether a second card can exist
 * at all. Counting the rendered cards instead would make a layout regression
 * look like "the server only has one monitor" and pass (refs #233).
 */
export async function getMonitorCount(): Promise<number> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/monitors.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API monitor list fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { monitors?: unknown[] };
  return data.monitors?.length ?? 0;
}

/**
 * How many events the server has recorded.
 *
 * The events steps gate on "does this server have any events" before asserting
 * anything about event cards. Deriving that from the rendered cards makes a
 * broken list look like an empty server and passes every downstream step
 * (refs #237). Asks the API instead. Reads only the pagination count, so it
 * does not depend on the default page size.
 */
export async function getEventCount(): Promise<number> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/events.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API event list fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { pagination?: { count?: number }; events?: unknown[] };
  return data.pagination?.count ?? data.events?.length ?? 0;
}
