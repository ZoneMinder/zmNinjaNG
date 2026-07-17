/**
 * Developer Notice Feed API
 *
 * One-way broadcast channel from the maintainer to all users. Fetches a
 * static JSON feed (DEVELOPER_NOTICES.feedUrl) with no auth headers. The
 * feed lives in the repo at docs/notices.json and is served via GitHub's
 * raw URL: there is no backend and no telemetry.
 */

import { z } from 'zod';
import { httpGet } from '../lib/http';
import { DEVELOPER_NOTICES } from '../lib/zmninja-ng-constants';
import { validateApiResponse } from '../lib/zm/api-validator';
import { tolerantArray } from '../lib/zm/schema-tolerance';

export const DeveloperNoticeSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type DeveloperNoticeSeverity = z.infer<typeof DeveloperNoticeSeveritySchema>;

export const DeveloperNoticeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  publishedAt: z.string(),
  severity: DeveloperNoticeSeveritySchema.default('info'),
  link: z.string().url().optional(),
  /** When set, hide the notice on app versions older than this. */
  minAppVersion: z.string().optional(),
});

export type DeveloperNotice = z.infer<typeof DeveloperNoticeSchema>;

// A single malformed notice must not blank the whole feed (rule 43). The notice
// fields stay strict on purpose: this is our own feed, and a notice missing an
// id or title is useless, so dropping just that one is the right outcome.
export const DeveloperNoticeFeedSchema = tolerantArray(DeveloperNoticeSchema, 'developer notice');

/**
 * Fetch the notice feed. Uses httpGet directly (not the api client) so the
 * request bypasses auth, cookies, and the ZM baseURL. This URL is a public
 * raw GitHub file. Validation strips malformed entries upstream of the UI.
 *
 * GitHub raw serves the file with Content-Type: text/plain, so on iOS/Android
 * CapacitorHttp returns the body as a string instead of a parsed object.
 * Parse defensively before handing to Zod.
 */
export async function fetchDeveloperNotices(): Promise<DeveloperNotice[]> {
  const url = import.meta.env.DEV
    ? `${window.location.origin}/__dev-notices.json`
    : DEVELOPER_NOTICES.feedUrl;
  const response = await httpGet<unknown>(url, {
    headers: { 'Skip-Auth': 'true' },
    timeoutMs: 10_000,
    intent: 'Fetch developer notices',
  });
  const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  return validateApiResponse(DeveloperNoticeFeedSchema, data, {
    endpoint: url,
    method: 'GET',
  });
}
