/**
 * Converts the assistant's STRUCTURED time-window fields into concrete ZM API
 * datetime strings (refs #265).
 *
 * The model interprets the user's time words, in any phrasing and language,
 * into flat fields (`lastCount`+`lastUnit`, `daysAgo`, `weekday`, `date`,
 * `fromTime`/`toTime`); this module only does arithmetic on them. This
 * replaced an English phrase grammar (`resolveWhen`) that understood exactly
 * the phrasings someone had written regexes for and silently failed on every
 * other human variant. Interpretation is what a language model is good at;
 * date arithmetic is what code is good at; each now does its own job.
 *
 * `now` and `timezone` are explicit parameters, never read from a store, so
 * this stays pure and unit-testable with a fixed clock and a fixed zone
 * regardless of the CI runner's own system timezone.
 */
import { subHours, startOfDay, subDays, addMinutes, format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { ZM_API_DATETIME_FORMAT } from '../zm/zm-constants';

/** Closed, universal sets: the tool CONTRACT, not a vocabulary. The model
 *  maps whatever the user said onto these; no word list exists app-side. */
export const WINDOW_UNITS = ['minute', 'hour', 'day', 'week', 'month'] as const;
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const UNIT_HOURS: Record<(typeof WINDOW_UNITS)[number], number> = {
  minute: 1 / 60,
  hour: 1,
  day: 24,
  // ponytail: rolling approximations; calendar-aligned weeks/months are a
  // `calendarAgo` field away if anyone asks for "last calendar month".
  week: 24 * 7,
  month: 24 * 30,
};

/** The window fields the event tools accept. All optional; validation of
 *  combinations happens in `resolveWindow` with corrective errors. */
export interface WindowFields {
  lastCount?: number;
  lastUnit?: string;
  daysAgo?: number;
  weekday?: string;
  date?: string;
  /** Calendar span, inclusive on both ends: "april" is fromDate 2026-04-01 +
   *  toDate 2026-04-30. Either side may stand alone ("since july 1"). The
   *  general primitive for every calendar-aligned window (a named month,
   *  "this month", an explicit range, a year), so no month/quarter/year
   *  field list ever needs enumerating (refs #265). */
  fromDate?: string;
  toDate?: string;
  fromTime?: string;
  toTime?: string;
}

export interface ResolvedEventRange {
  /** Either side may be absent for a one-sided window ("since july 1"). */
  startDateTime?: string;
  endDateTime?: string;
}

/** Formats a real instant as the ZM API's local-timezone datetime string.
 *  `toZonedTime` + `format` is date-fns-tz's own documented recipe for this. */
function formatForZm(instant: Date, timezone: string): string {
  return format(toZonedTime(instant, timezone), ZM_API_DATETIME_FORMAT);
}

/** Local midnight, `daysAgo` calendar days before `now`'s day in `timezone`,
 *  returned as a real UTC instant. */
function localMidnight(now: Date, timezone: string, daysAgo: number): Date {
  const zonedToday = startOfDay(toZonedTime(now, timezone));
  const zonedMidnight = daysAgo > 0 ? subDays(zonedToday, daysAgo) : zonedToday;
  return fromZonedTime(zonedMidnight, timezone);
}

/** Strict `HH:MM` (24h) as minutes past midnight, or undefined. The model is
 *  asked for exactly this shape; anything else is refused, not guessed at. */
function clockMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/**
 * The exact start/stop pair the window fields describe, an `{error}` written
 * for the model to correct from, or `undefined` when no window field was
 * given at all (an unfiltered query, which the caller reports as such).
 */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Local midnight at the start of `date` (YYYY-MM-DD) in `timezone`, plus
 *  `dayOffset` days, as a real instant. */
function dateMidnight(date: string, timezone: string, dayOffset: number): Date | undefined {
  const parsed = new Date(`${date}T12:00:00`);
  // An impossible calendar date must become a corrective error upstream:
  // V8 turns a 13th month into Invalid Date but ROLLS 2026-02-29 over to
  // March 1, so a round-trip compare is needed, not just a NaN check.
  if (Number.isNaN(parsed.getTime()) || format(parsed, 'yyyy-MM-dd') !== date) return undefined;
  const zoned = startOfDay(toZonedTime(fromZonedTime(parsed, timezone), timezone));
  return fromZonedTime(dayOffset === 0 ? zoned : subDays(zoned, -dayOffset), timezone);
}

export function resolveWindow(
  fields: WindowFields,
  now: Date,
  timezone: string,
): ResolvedEventRange | { error: string } | undefined {
  const { lastCount, lastUnit, daysAgo, weekday, date, fromDate, toDate, fromTime, toTime } = fields;
  const dayPickers = [daysAgo !== undefined, weekday !== undefined, date !== undefined].filter(Boolean).length;
  const rolling = lastCount !== undefined || lastUnit !== undefined;
  const ranged = fromDate !== undefined || toDate !== undefined;

  if ([rolling, dayPickers > 0, ranged].filter(Boolean).length > 1) {
    return { error: 'Send ONE window shape: a rolling window (lastCount+lastUnit), a day (daysAgo, weekday, or date), or a span (fromDate/toDate).' };
  }
  if (dayPickers > 1) {
    return { error: 'Send only one of daysAgo, weekday, or date.' };
  }

  if (ranged) {
    if (fromTime !== undefined || toTime !== undefined) {
      return { error: 'fromTime/toTime narrow a single day; use daysAgo, weekday, or date alongside them.' };
    }
    for (const [name, value] of [['fromDate', fromDate], ['toDate', toDate]] as const) {
      if (value !== undefined && !DATE_SHAPE.test(String(value).trim())) {
        return { error: `${name} must be "YYYY-MM-DD". Received "${String(value)}".` };
      }
    }
    const start = fromDate === undefined ? undefined : dateMidnight(String(fromDate).trim(), timezone, 0);
    // toDate is INCLUSIVE: the window closes at the midnight after it,
    // capped at now so "this month" never claims the future.
    const endRaw = toDate === undefined ? undefined : dateMidnight(String(toDate).trim(), timezone, 1);
    if ((fromDate !== undefined && start === undefined) || (toDate !== undefined && endRaw === undefined)) {
      return { error: `"${String(start === undefined ? fromDate : toDate)}" is not a real calendar date.` };
    }
    const end = endRaw === undefined ? undefined : endRaw.getTime() > now.getTime() ? now : endRaw;
    if (start && start.getTime() > now.getTime()) {
      return { error: `fromDate "${String(fromDate)}" is in the future.` };
    }
    if (start && end && end.getTime() <= start.getTime()) {
      return { error: 'toDate must be on or after fromDate.' };
    }
    return {
      ...(start ? { startDateTime: formatForZm(start, timezone) } : {}),
      ...(end ? { endDateTime: formatForZm(end, timezone) } : {}),
    };
  }

  if (rolling) {
    if (lastCount === undefined || lastUnit === undefined) {
      return { error: 'A rolling window needs both lastCount and lastUnit.' };
    }
    const count = Number(lastCount);
    if (!Number.isFinite(count) || count <= 0) {
      return { error: `lastCount must be a positive number. Received "${String(lastCount)}".` };
    }
    const unit = String(lastUnit).toLowerCase() as (typeof WINDOW_UNITS)[number];
    if (!WINDOW_UNITS.includes(unit)) {
      return { error: `lastUnit must be one of: ${WINDOW_UNITS.join(', ')}. Received "${String(lastUnit)}".` };
    }
    if (fromTime !== undefined || toTime !== undefined) {
      return { error: 'fromTime/toTime narrow a single day; they cannot combine with a rolling window.' };
    }
    return {
      startDateTime: formatForZm(subHours(now, UNIT_HOURS[unit] * count), timezone),
      endDateTime: formatForZm(now, timezone),
    };
  }

  let back: number | undefined;
  if (daysAgo !== undefined) {
    const n = Number(daysAgo);
    if (!Number.isFinite(n) || n < 0) return { error: `daysAgo must be 0 or more. Received "${String(daysAgo)}".` };
    back = Math.floor(n);
  } else if (weekday !== undefined) {
    const target = WEEKDAYS.indexOf(String(weekday).toLowerCase() as (typeof WEEKDAYS)[number]);
    if (target === -1) return { error: `weekday must be one of: ${WEEKDAYS.join(', ')}. Received "${String(weekday)}".` };
    // Most recent such day, today included: the model interprets "last
    // sunday" vs "sunday" itself and can send daysAgo when it means a
    // different week.
    back = (toZonedTime(now, timezone).getDay() - target + 7) % 7;
  } else if (date !== undefined) {
    const text = String(date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return { error: `date must be "YYYY-MM-DD". Received "${String(date)}".` };
    }
    const zonedToday = startOfDay(toZonedTime(now, timezone));
    const zonedTarget = startOfDay(toZonedTime(fromZonedTime(new Date(`${text}T12:00:00`), timezone), timezone));
    back = Math.round((zonedToday.getTime() - zonedTarget.getTime()) / 86_400_000);
    if (back < 0) return { error: `date "${text}" is in the future.` };
  }

  if (back === undefined) {
    if (fromTime !== undefined || toTime !== undefined) {
      return { error: 'fromTime/toTime need a day: send daysAgo, weekday, or date alongside them.' };
    }
    return undefined;
  }

  const dayStart = localMidnight(now, timezone, back);
  const dayEnd = back === 0 ? now : localMidnight(now, timezone, back - 1);

  const fromMinutes = fromTime === undefined ? undefined : clockMinutes(String(fromTime));
  const toMinutes = toTime === undefined ? undefined : clockMinutes(String(toTime));
  if (fromTime !== undefined && fromMinutes === undefined) {
    return { error: `fromTime must be 24h "HH:MM". Received "${String(fromTime)}".` };
  }
  if (toTime !== undefined && toMinutes === undefined) {
    return { error: `toTime must be 24h "HH:MM". Received "${String(toTime)}".` };
  }
  if (fromMinutes !== undefined && toMinutes !== undefined && toMinutes <= fromMinutes) {
    return { error: 'toTime must be after fromTime.' };
  }

  return {
    startDateTime: formatForZm(fromMinutes === undefined ? dayStart : addMinutes(dayStart, fromMinutes), timezone),
    endDateTime: formatForZm(toMinutes === undefined ? dayEnd : addMinutes(dayStart, toMinutes), timezone),
  };
}
