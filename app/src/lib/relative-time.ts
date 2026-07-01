/**
 * Compact, localized "how long ago" labels for event times (issue #210).
 *
 * Uses Intl.RelativeTimeFormat with the short style so labels read as
 * "40 min. ago" / "3 hr. ago" rather than full words, localized per app
 * language. Under RELATIVE_TIME_JUST_NOW_MS the label is t('events.now').
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

/** True if `date` is between `now` and `days` days before it (inclusive). */
export function isWithinDays(date: Date, days: number, now: Date = new Date()): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Compact localized relative label. Within RELATIVE_TIME_JUST_NOW_MS of now
 * returns t('events.now'). Otherwise a short "N unit ago" string (or "in N
 * unit" for a future date) localized to `lang`.
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

  const rtf = new Intl.RelativeTimeFormat(lang || 'en', { style: 'short', numeric: 'always' });
  const absSec = Math.abs(diffMs) / 1000;
  const past = diffMs >= 0;
  for (const [unit, secs] of UNITS) {
    if (absSec >= secs) {
      const value = Math.floor(absSec / secs);
      return rtf.format(past ? -value : value, unit);
    }
  }
  // Unreachable while RELATIVE_TIME_JUST_NOW_MS >= 60_000 (the loop's last unit
  // is minute at 60s). Kept as a defensive default if that threshold ever drops.
  return rtf.format(past ? -1 : 1, 'minute');
}
