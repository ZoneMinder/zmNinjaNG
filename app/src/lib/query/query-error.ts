/**
 * Query Error Resolution
 *
 * Maps a React Query error to a user-facing message. Folds in the
 * 401/unauthorized -> "auth required" case shared by the pages that render
 * a raw error banner from a query's `error` object (Events, Monitors).
 */

import type { TFunction } from 'i18next';
import { isAbortError } from '../is-abort-error';

export interface ResolveQueryErrorOptions {
  /**
   * i18n key for the non-auth fallback message, interpolated with
   * `{ error: message }`. Defaults to `${t('common.error')}: ${message}`.
   */
  fallbackKey?: string;
}

export function resolveQueryError(
  err: unknown,
  t: TFunction,
  options: ResolveQueryErrorOptions = {}
): string {
  const message = (err as Error)?.message || t('common.unknown_error');
  // `createHttpError` (lib/http/types.ts) puts the code on a flat `status`.
  // Nothing here produces an axios-shaped `.response.status` envelope.
  const status = (err as { status?: number })?.status;
  if (status === 401 || /unauthorized/i.test(message)) {
    return t('common.auth_required');
  }
  // A request that never reached the server has no status, because there was
  // no response to take one from; an HTTP error always has one. That is the
  // whole test, and it is deliberately structural: the four adapters word this
  // failure four different ways ("failed to connect to /IP (port N)",
  // "connect ECONNREFUSED IP:port", "Could not connect to the server",
  // "Failed to fetch"), and matching on those strings would drift the moment a
  // platform reworded one. The host is read off the error, stamped by
  // `lib/http.ts` from the URL it dialled, so the address shown is the app's
  // own and carries none of the platform's formatting (refs #312).
  //
  // Aborts also lack a status and are NOT failures to reach anything: a user
  // cancelling must not be told the server is unreachable. (`isTimeoutError`
  // treats an abort as a timeout, which is why it is not the helper here.)
  const host = (err as { host?: string })?.host;
  if (status === undefined && host && !isAbortError(err)) {
    return t('common.cannot_reach_host', { host });
  }
  if (options.fallbackKey) {
    return t(options.fallbackKey, { error: message });
  }
  return `${t('common.error')}: ${message}`;
}
