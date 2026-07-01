/**
 * Compact, localized "how long ago" labels for event times (issue #210).
 *
 * Uses Intl.RelativeTimeFormat with the narrow style so labels read as
 * "40m ago" / "3h ago" rather than full words, localized per app language.
 * Under RELATIVE_TIME_JUST_NOW_MS the label is t('events.now').
 */

import type { TFunction } from 'i18next';
import { RELATIVE_TIME_JUST_NOW_MS } from './zmninja-ng-constants';

// Unit thresholds in seconds, largest first. The first unit whose size fits
// within the elapsed time is used.
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31557600],
  ['month', 2629800],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * Format one relative value with the narrow style, falling back to short.
 *
 * Some locales render the narrow form as a bare signed number, e.g. French
 * gives "-40 min" which reads as negative rather than "ago". When the narrow
 * output starts with a sign, use the short style instead, which spells the
 * direction ("il y a 40 min").
 */
function formatUnit(lang: string, value: number, unit: Intl.RelativeTimeFormatUnit): string {
  const narrow = new Intl.RelativeTimeFormat(lang, { style: 'narrow', numeric: 'always' }).format(value, unit);
  if (/^[+\-−﹣]/.test(narrow.trim())) {
    return new Intl.RelativeTimeFormat(lang, { style: 'short', numeric: 'always' }).format(value, unit);
  }
  return narrow;
}

/** True if `date` is between `now` and `days` days before it (inclusive). */
export function isWithinDays(date: Date, days: number, now: Date = new Date()): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Compact localized relative label. Within RELATIVE_TIME_JUST_NOW_MS of now
 * returns t('events.now'). Otherwise a narrow "Nm ago" style string (or the
 * future equivalent) localized to `lang`.
 */
export function formatEventRelative(
  date: Date,
  lang: string | undefined,
  t: TFunction,
  now: Date = new Date()
): string {
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = now.getTime() - date.getTime();
  if (Math.abs(diffMs) < RELATIVE_TIME_JUST_NOW_MS) return t('events.now');

  const loc = lang || 'en';
  const absSec = Math.abs(diffMs) / 1000;
  const past = diffMs >= 0;
  for (const [unit, secs] of UNITS) {
    if (absSec >= secs) {
      const value = Math.floor(absSec / secs);
      return formatUnit(loc, past ? -value : value, unit);
    }
  }
  // Unreachable while RELATIVE_TIME_JUST_NOW_MS >= 60_000 (the loop's last unit
  // is minute at 60s). Kept as a defensive default if that threshold ever drops.
  return formatUnit(loc, past ? -1 : 1, 'minute');
}
