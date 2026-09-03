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

/** The interpreter's weekend enum mapped to a weekends-ago count, so the schema
 *  can constrain the model to exact strings while the arithmetic stays numeric.
 *  ponytail: three values cover every measured phrase; older weekends are a new
 *  enum entry away if anyone asks for "three weekends ago". */
const WEEKEND_REF: Record<string, number> = { this: 0, last: 1, 'two-ago': 2 };

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
  /** A span between two weekdays ("between mon and tue"), most recent such
   *  span ending on or before today. Code resolves both dates, because the
   *  model anchored the wrong calendar day when forced to compute them
   *  (refs #434). */
  fromWeekday?: string;
  toWeekday?: string;
  /** A calendar week, Monday-anchored, resolved in code (refs #438): "this"
   *  is Monday 00:00 through now, "last" the previous Monday through
   *  Sunday. Distinct from a rolling lastUnit:"week", which ends now. */
  week?: string;
  /** A calendar month, resolved in code (refs #449): "this" is the 1st
   *  through now, "last" the whole previous month. Exists because a
   *  schema-less backend (Gemini Nano) expressed "this month" as a rolling
   *  30 days - the vocabulary simply had no calendar-month word. */
  month?: string;
  /** Most recent past day with this day-of-month number (1-31): "the 21st".
   *  Code finds the date, exactly as `weekday` finds the most recent weekday,
   *  because a small model resolves a bare ordinal to the wrong ISO date. */
  dayOfMonth?: number;
  /** Which past weekend. The model sends a string enum ("this"/"last"/
   *  "two-ago") because it is exact on enums but junk-fills a bare number;
   *  `WEEKEND_REF` maps it to a weekends-ago count (0 the most recent
   *  Saturday+Sunday, 1 the one before). Code computes the two dates; the model
   *  cannot reliably work out a weekend's calendar dates (refs #270). A legacy
   *  numeric value still resolves. */
  weekend?: number | string;
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

/** The last real day of a month, so an over-long span end from the model
 *  ("february" as 2026-02-29, a 31-day April) becomes the month's actual end
 *  rather than a corrective error. Day 0 of the next month is that last day. */
function clampToMonthEnd(date: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  const last = new Date(Number(match[1]), month, 0).getDate();
  return `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}`;
}

export function resolveWindow(
  fields: WindowFields,
  now: Date,
  timezone: string,
): ResolvedEventRange | { error: string } | undefined {
  const { lastCount, lastUnit, daysAgo, weekday, fromWeekday, toWeekday, week, month, dayOfMonth, weekend, date, fromDate, toDate, fromTime, toTime } = fields;
  const dayPickers = [daysAgo !== undefined, weekday !== undefined, dayOfMonth !== undefined, date !== undefined].filter(Boolean).length;
  const rolling = lastCount !== undefined || lastUnit !== undefined;
  const ranged = fromDate !== undefined || toDate !== undefined;
  const weekendShape = weekend !== undefined;
  const weekdayRange = fromWeekday !== undefined || toWeekday !== undefined;
  const weekShape = week !== undefined;
  const monthShape = month !== undefined;

  if ([rolling, dayPickers > 0, ranged, weekendShape, weekdayRange, weekShape, monthShape].filter(Boolean).length > 1) {
    return { error: 'Send ONE window shape: a rolling window (lastCount+lastUnit), a day (daysAgo, weekday, dayOfMonth, or date), a weekday span (fromWeekday+toWeekday), a calendar week, a calendar month, a weekend, or a span (fromDate/toDate).' };
  }

  if (monthShape) {
    if (month !== 'this' && month !== 'last') {
      return { error: `month must be "this" or "last". Received "${String(month)}".` };
    }
    const zonedNow = toZonedTime(now, timezone);
    const first = new Date(zonedNow.getFullYear(), zonedNow.getMonth() - (month === 'last' ? 1 : 0), 1);
    const nextFirst = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    const start = fromZonedTime(first, timezone);
    const endRaw = fromZonedTime(nextFirst, timezone);
    const end = endRaw.getTime() > now.getTime() ? now : endRaw;
    return { startDateTime: formatForZm(start, timezone), endDateTime: formatForZm(end, timezone) };
  }

  if (weekShape) {
    if (week !== 'this' && week !== 'last') {
      return { error: `week must be "this" or "last". Received "${String(week)}".` };
    }
    const zonedToday = startOfDay(toZonedTime(now, timezone));
    const daysSinceMonday = (toZonedTime(now, timezone).getDay() + 6) % 7;
    const monday = subDays(zonedToday, daysSinceMonday + (week === 'last' ? 7 : 0));
    const start = fromZonedTime(monday, timezone);
    const endRaw = fromZonedTime(subDays(monday, -7), timezone);
    const end = endRaw.getTime() > now.getTime() ? now : endRaw;
    return { startDateTime: formatForZm(start, timezone), endDateTime: formatForZm(end, timezone) };
  }
  if (dayPickers > 1) {
    return { error: 'Send only one of daysAgo, weekday, dayOfMonth, or date.' };
  }

  if (weekdayRange) {
    if (fromTime !== undefined || toTime !== undefined) {
      return { error: 'fromTime/toTime narrow a single day; use daysAgo, weekday, or date alongside them.' };
    }
    const fromIdx = WEEKDAYS.indexOf(String(fromWeekday).toLowerCase() as (typeof WEEKDAYS)[number]);
    const toIdx = WEEKDAYS.indexOf(String(toWeekday).toLowerCase() as (typeof WEEKDAYS)[number]);
    if (fromIdx === -1 || toIdx === -1) {
      return { error: `fromWeekday and toWeekday must BOTH be one of: ${WEEKDAYS.join(', ')}. Received "${String(fromWeekday)}" and "${String(toWeekday)}".` };
    }
    // Most recent end day (today included), then back to the start weekday at
    // or before it; a same-day pair spans that one day.
    const zonedNow = toZonedTime(now, timezone);
    const endDay = startOfDay(subDays(zonedNow, (zonedNow.getDay() - toIdx + 7) % 7));
    const startDay = subDays(endDay, (toIdx - fromIdx + 7) % 7);
    const start = fromZonedTime(startDay, timezone);
    // Inclusive of the end day: the window closes at the following midnight,
    // capped at now, mirroring the weekend and toDate shapes.
    const endRaw = fromZonedTime(subDays(endDay, -1), timezone);
    const end = endRaw.getTime() > now.getTime() ? now : endRaw;
    return { startDateTime: formatForZm(start, timezone), endDateTime: formatForZm(end, timezone) };
  }

  if (weekendShape) {
    const n = typeof weekend === 'string' && weekend in WEEKEND_REF ? WEEKEND_REF[weekend] : Number(weekend);
    if (!Number.isInteger(n) || n < 0) {
      return { error: `weekend must be 0 (this weekend) or a whole number of weekends ago. Received "${String(weekend)}".` };
    }
    // Most recent Saturday on or before today, then n weekends further back.
    const zonedToday = startOfDay(toZonedTime(now, timezone));
    const daysSinceSaturday = (toZonedTime(now, timezone).getDay() + 1) % 7; // Sat->0, Sun->1
    const saturday = subDays(zonedToday, daysSinceSaturday + 7 * n);
    const start = fromZonedTime(saturday, timezone);
    // Inclusive of Sunday: the window closes at the Monday midnight, capped at now.
    const endRaw = fromZonedTime(subDays(saturday, -2), timezone);
    const end = endRaw.getTime() > now.getTime() ? now : endRaw;
    return { startDateTime: formatForZm(start, timezone), endDateTime: formatForZm(end, timezone) };
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
    // capped at now so "this month" never claims the future. An over-long month
    // end (the model's 2026-02-29) clamps to the month's real last day.
    let endRaw = toDate === undefined ? undefined : dateMidnight(String(toDate).trim(), timezone, 1);
    if (toDate !== undefined && endRaw === undefined) {
      const clamped = clampToMonthEnd(String(toDate).trim());
      if (clamped) endRaw = dateMidnight(clamped, timezone, 1);
    }
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
  } else if (dayOfMonth !== undefined) {
    const target = Number(dayOfMonth);
    if (!Number.isInteger(target) || target < 1 || target > 31) {
      return { error: `dayOfMonth must be a whole number 1-31. Received "${String(dayOfMonth)}".` };
    }
    // Most recent day (today included) whose day-of-month is `target`, scanning
    // back at most two months so a 31st still lands in a shorter month's past.
    const zonedToday = startOfDay(toZonedTime(now, timezone));
    let probe = zonedToday;
    let found = false;
    for (let i = 0; i < 62; i++) {
      if (probe.getDate() === target) { found = true; break; }
      probe = subDays(probe, 1);
    }
    if (!found) return { error: `No recent day numbered ${target}.` };
    back = Math.round((zonedToday.getTime() - probe.getTime()) / 86_400_000);
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
