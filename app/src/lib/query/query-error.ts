/**
 * Query Error Resolution
 *
 * Maps a React Query error to a user-facing message. Folds in the
 * 401/unauthorized -> "auth required" case shared by the pages that render
 * a raw error banner from a query's `error` object (Events, Monitors).
 */

import type { TFunction } from 'i18next';

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
  if (options.fallbackKey) {
    return t(options.fallbackKey, { error: message });
  }
  return `${t('common.error')}: ${message}`;
}
