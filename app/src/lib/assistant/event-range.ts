/**
 * Resolves the assistant's relative event-date filters ("today", "yesterday",
 * rolling windows) into concrete ZM API datetime strings (refs #246).
 *
 * Small/local models (Gemma, Qwen, etc. run through Ollama or on-device) are
 * unreliable at computing an ISO timestamp for "today" or "yesterday"
 * themselves: this is why `list_events`' `when` input exists at all (see
 * `tools-readonly.ts`). Resolving it here, in app code, means the model only
 * ever has to repeat the user's phrase, never compute a date. `now` and
 * `timezone` are both explicit parameters, never read from a store, so this
 * stays pure and unit-testable with a fixed clock and a fixed zone regardless
 * of the CI runner's own system timezone.
 */
import { subHours, subDays, startOfDay, addMinutes, format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { ZM_API_DATETIME_FORMAT } from '../zm/zm-constants';

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

/** One clock time expressed the way people write it, as minutes past
 *  midnight: "4pm", "4:30pm", "16:00", "noon", "midnight". Undefined if the
 *  text is not a time at all. */
export function parseClockTime(text: string): number | undefined {
  const value = text.trim().toLowerCase().replace(/\./g, '');
  if (value === 'noon' || value === 'midday') return 12 * 60;
  if (value === 'midnight') return 0;

  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value);
  if (!match) return undefined;
  const [, rawHour, rawMinute, meridiem] = match;
  let hour = Number(rawHour);
  const minute = Number(rawMinute ?? '0');
  if (minute > 59) return undefined;

  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return undefined;
  }
  return hour * 60 + minute;
}

/** How many days back a day-word refers to, or undefined if it is not one. */
function dayWordOffset(word: string): number | undefined {
  if (/^to-?day$/.test(word)) return 0;
  if (/^yester-?day$/.test(word)) return 1;
  return undefined;
}

const ROLLING_UNIT_HOURS: Record<string, number> = {
  minute: 1 / 60, minutes: 1 / 60,
  hour: 1, hours: 1,
  day: 24, days: 24,
  week: 24 * 7, weeks: 24 * 7,
  month: 24 * 30, months: 24 * 30,
};

/**
 * Resolves a time window written the way a person says it.
 *
 * This exists because asking the model for a date is the one thing it
 * reliably gets wrong. Measured on llama3.2, "how many people came yesterday
 * from 4pm to 10pm" produced `range: "yesterday from 16:00 to 22:00"` (prose
 * in an enum field), and full ISO pairs ending on the 19th and the 20th when
 * yesterday was the 18th. The model is good at repeating the phrase the user
 * typed and bad at arithmetic on it, so the tool now takes the phrase and does
 * the arithmetic here, where a fixed clock and a fixed zone make it testable.
 *
 * Understood:
 *   "today", "yesterday"
 *   "last hour", "last 24 hours", "past 30 minutes", "last 7 days"
 *   "yesterday from 4pm to 10pm", "today between 9am and noon"
 *   "yesterday after 4pm", "today before noon"
 *
 * Returns an error message (not a throw) naming what was not understood, so
 * the caller can hand it back to the model as a correction.
 */
export function resolveWhen(
  phrase: string,
  now: Date,
  timezone: string,
): ResolvedEventRange | { error: string } {
  // The enum keywords this parameter replaced, in case a model repeats one
  // from an older conversation or a persisted thread.
  const LEGACY = new Map([
    ['last_hour', 'last hour'], ['last_24h', 'last 24 hours'],
    ['last_7d', 'last 7 days'], ['last_30d', 'last 30 days'],
  ]);
  const raw = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  const text = LEGACY.get(raw) ?? raw;
  if (!text) return { error: 'when was empty.' };

  // "last 7 days" / "past 30 minutes" / "last hour"
  const rolling = /^(?:in the )?(?:last|past|previous) (\d+ )?(minute|minutes|hour|hours|day|days|week|weeks|month|months)$/.exec(text);
  if (rolling) {
    const count = Number(rolling[1] ?? '1');
    const hours = ROLLING_UNIT_HOURS[rolling[2]] * count;
    return { startDateTime: formatForZm(subHours(now, hours), timezone), endDateTime: formatForZm(now, timezone) };
  }

  // A day word, optionally narrowed to part of that day.
  const dayMatch = /^(to-?day|yester-?day)(?: (.*))?$/.exec(text);
  if (dayMatch) {
    const daysAgo = dayWordOffset(dayMatch[1])!;
    const dayStart = localMidnight(now, timezone, daysAgo);
    const rest = dayMatch[2]?.trim();

    // The whole day. "today" ends now rather than at a midnight that has not
    // happened yet.
    if (!rest) {
      return {
        startDateTime: formatForZm(dayStart, timezone),
        endDateTime: formatForZm(daysAgo === 0 ? now : localMidnight(now, timezone, daysAgo - 1), timezone),
      };
    }

    const window =
      /^(?:from |between )?(.+?) (?:to|and|until|till|-) (.+)$/.exec(rest) ??
      /^(after|since|before|until) (.+)$/.exec(rest);
    if (!window) return { error: `Could not read "${rest}" as a time of day.` };

    const isBound = /^(after|since|before|until)$/.test(window[1]);
    const startText = isBound ? undefined : window[1];
    const endText = isBound ? undefined : window[2];
    const boundMinutes = isBound ? parseClockTime(window[2]) : undefined;

    if (isBound) {
      if (boundMinutes === undefined) return { error: `Could not read "${window[2]}" as a time of day.` };
      const at = addMinutes(dayStart, boundMinutes);
      const dayEnd = daysAgo === 0 ? now : localMidnight(now, timezone, daysAgo - 1);
      return /^(after|since)$/.test(window[1])
        ? { startDateTime: formatForZm(at, timezone), endDateTime: formatForZm(dayEnd, timezone) }
        : { startDateTime: formatForZm(dayStart, timezone), endDateTime: formatForZm(at, timezone) };
    }

    const startMinutes = parseClockTime(startText!);
    const endMinutes = parseClockTime(endText!);
    if (startMinutes === undefined) return { error: `Could not read "${startText}" as a time of day.` };
    if (endMinutes === undefined) return { error: `Could not read "${endText}" as a time of day.` };
    if (endMinutes <= startMinutes) {
      return { error: `"${endText}" is not after "${startText}"; a window cannot end before it starts.` };
    }
    return {
      startDateTime: formatForZm(addMinutes(dayStart, startMinutes), timezone),
      endDateTime: formatForZm(addMinutes(dayStart, endMinutes), timezone),
    };
  }

  return {
    error:
      `Could not read "${phrase}" as a time window. Use a phrase like "today", "yesterday", ` +
      '"last 24 hours", "last 7 days", "yesterday from 4pm to 10pm", or "today before noon".',
  };
}
