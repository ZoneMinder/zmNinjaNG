/**
 * Compact, localized "how long ago" labels for event times (issue #210).
 *
 * Wraps date-fns formatDistanceStrict (single unit, e.g. "40 minutes ago")
 * rather than formatDistanceToNow (fuzzy "about 1 hour ago"), and maps the app
 * language to a date-fns locale so the suffix is translated for all 5 languages.
 */

import { formatDistanceStrict, type Locale } from 'date-fns';
import { enUS, de, es, fr, zhCN } from 'date-fns/locale';
import type { TFunction } from 'i18next';
import { RELATIVE_TIME_JUST_NOW_MS } from './zmninja-ng-constants';

const LOCALES: Record<string, Locale> = { en: enUS, de, es, fr, zh: zhCN };

/** Map an i18n language code (e.g. "en", "en-US", "zh") to a date-fns locale. */
export function dateFnsLocaleFor(lang: string | undefined): Locale {
  const base = (lang || 'en').split('-')[0];
  return LOCALES[base] ?? enUS;
}

/** True if `date` is between `now` and `days` days before `now` (inclusive). */
export function isWithinDays(date: Date, days: number, now: Date = new Date()): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Compact localized relative label. Under the just-now threshold returns
 * t('events.just_now'); otherwise a single-unit "N units ago" string.
 */
export function formatEventRelative(
  date: Date,
  lang: string | undefined,
  t: TFunction,
  now: Date = new Date()
): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < RELATIVE_TIME_JUST_NOW_MS) return t('events.just_now');
  return formatDistanceStrict(date, now, {
    addSuffix: true,
    locale: dateFnsLocaleFor(lang),
  });
}
