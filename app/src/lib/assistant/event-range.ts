/**
 * Resolves the assistant's relative event-date filters ("today", "yesterday",
 * rolling windows) into concrete ZM API datetime strings (refs #246).
 *
 * Small/local models (Gemma, Qwen, etc. run through Ollama or on-device) are
 * unreliable at computing an ISO timestamp for "today" or "yesterday"
 * themselves: this is why `list_events`' `range` input exists at all (see
 * `tools-readonly.ts`). Resolving it here, in app code, means the model only
 * ever has to pick a keyword, never compute a date. `now` and `timezone` are
 * both explicit parameters, never read from a store, so this stays pure and
 * unit-testable with a fixed clock and a fixed zone regardless of the CI
 * runner's own system timezone.
 */
import { subHours, subDays, startOfDay, format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { ZM_API_DATETIME_FORMAT } from '../zm/zm-constants';

/** `today`/`yesterday` are calendar-day boundaries (local midnight to local
 *  midnight) in the caller's timezone. The rest are rolling windows ending
 *  "now": a fixed duration back from the current instant, not calendar-aligned. */
export const EVENT_RANGES = ['today', 'yesterday', 'last_hour', 'last_24h', 'last_7d', 'last_30d'] as const;
export type EventRange = (typeof EVENT_RANGES)[number];

/**
 * Whether `value` is a range `resolveEventRange` can actually resolve.
 *
 * Needed because `resolveEventRange`'s switch is exhaustive over `EventRange`
 * and therefore has no default branch: that exhaustiveness is a compile-time
 * proof about OUR callers, and says nothing about a model that answers with
 * "last week". Such a value fell through the switch, returned undefined, and
 * silently dropped the date filter, leaving an unscoped query answering a
 * question about a specific window. Anything crossing the model boundary must
 * pass through here first.
 */
export function isEventRange(value: unknown): value is EventRange {
  return typeof value === 'string' && (EVENT_RANGES as readonly string[]).includes(value);
}

export interface ResolvedEventRange {
  startDateTime: string;
  endDateTime: string;
}

/** Formats a real instant as the ZM API's local-timezone datetime string.
 *  `toZonedTime` + `format` is date-fns-tz's own documented recipe for this:
 *  `toZonedTime` shifts `instant` so that plain `Date` getters (which
 *  `date-fns`'s `format` reads) return `timezone`'s wall-clock values
 *  regardless of the runtime's own system timezone. */
function formatForZm(instant: Date, timezone: string): string {
  return format(toZonedTime(instant, timezone), ZM_API_DATETIME_FORMAT);
}

/** Local midnight, `daysAgo` calendar days before `now`'s day in `timezone`,
 *  returned as a real UTC instant. `fromZonedTime` is the reverse of
 *  `toZonedTime`: it reads `zonedMidnight`'s plain `Date` getters as
 *  `timezone`'s wall clock and converts that back to the actual instant. */
function localMidnight(now: Date, timezone: string, daysAgo: number): Date {
  const zonedToday = startOfDay(toZonedTime(now, timezone));
  const zonedMidnight = daysAgo > 0 ? subDays(zonedToday, daysAgo) : zonedToday;
  return fromZonedTime(zonedMidnight, timezone);
}

/** Resolves one `EventRange` keyword into `startDateTime`/`endDateTime`
 *  strings for `EventFilters`, anchored to `now` in `timezone`. */
export function resolveEventRange(range: EventRange, now: Date, timezone: string): ResolvedEventRange {
  switch (range) {
    case 'today':
      return { startDateTime: formatForZm(localMidnight(now, timezone, 0), timezone), endDateTime: formatForZm(now, timezone) };
    case 'yesterday':
      return {
        startDateTime: formatForZm(localMidnight(now, timezone, 1), timezone),
        endDateTime: formatForZm(localMidnight(now, timezone, 0), timezone),
      };
    case 'last_hour':
      return { startDateTime: formatForZm(subHours(now, 1), timezone), endDateTime: formatForZm(now, timezone) };
    case 'last_24h':
      return { startDateTime: formatForZm(subHours(now, 24), timezone), endDateTime: formatForZm(now, timezone) };
    case 'last_7d':
      return { startDateTime: formatForZm(subDays(now, 7), timezone), endDateTime: formatForZm(now, timezone) };
    case 'last_30d':
      return { startDateTime: formatForZm(subDays(now, 30), timezone), endDateTime: formatForZm(now, timezone) };
  }
}
