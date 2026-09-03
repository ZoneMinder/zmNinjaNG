/**
 * resolveWindow (refs #265): structured window fields in, exact ZM datetime
 * strings out. The model interprets human time words into these fields; this
 * module owns ONLY the arithmetic, so these tests fix the clock and the zone
 * and assert exact wall-clock strings.
 */
import { describe, it, expect } from 'vitest';
import { resolveWindow } from '../event-range';

// 2026-07-16T14:30:00Z is Thursday 2026-07-16 10:30:00 in America/New_York
// (EDT, UTC-4) and 2026-07-16 23:30:00 in Asia/Tokyo (UTC+9).
const NOW = new Date('2026-07-16T14:30:00Z');
const at = (fields: Parameters<typeof resolveWindow>[0], timezone = 'America/New_York') =>
  resolveWindow(fields, NOW, timezone);

describe('rolling windows', () => {
  it('resolves lastCount+lastUnit back from now', () => {
    expect(at({ lastCount: 1, lastUnit: 'hour' })).toEqual({
      startDateTime: '2026-07-16 09:30:00',
      endDateTime: '2026-07-16 10:30:00',
    });
    expect(at({ lastCount: 7, lastUnit: 'day' })).toEqual({
      startDateTime: '2026-07-09 10:30:00',
      endDateTime: '2026-07-16 10:30:00',
    });
    expect(at({ lastCount: 1, lastUnit: 'week' })).toEqual({
      startDateTime: '2026-07-09 10:30:00',
      endDateTime: '2026-07-16 10:30:00',
    });
    expect(at({ lastCount: 30, lastUnit: 'minute' })).toEqual({
      startDateTime: '2026-07-16 10:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
  });

  it('rejects half a rolling window, a bad unit, and a bad count with corrective errors', () => {
    expect(at({ lastCount: 7 })).toMatchObject({ error: expect.stringContaining('lastUnit') });
    expect(at({ lastUnit: 'day' })).toMatchObject({ error: expect.stringContaining('lastCount') });
    expect(at({ lastCount: 7, lastUnit: 'fortnight' })).toMatchObject({ error: expect.stringContaining('lastUnit must be one of') });
    expect(at({ lastCount: -2, lastUnit: 'day' })).toMatchObject({ error: expect.stringContaining('positive') });
  });

  it('rejects a rolling window combined with a day field or day narrowing', () => {
    expect(at({ lastCount: 1, lastUnit: 'day', daysAgo: 1 })).toMatchObject({ error: expect.stringContaining('ONE window shape') });
    expect(at({ lastCount: 1, lastUnit: 'day', fromTime: '16:00' })).toMatchObject({
      error: expect.stringContaining('cannot combine'),
    });
  });
});

describe('single days', () => {
  it('resolves daysAgo as calendar days: 0 ends now, 1 is midnight to midnight', () => {
    expect(at({ daysAgo: 0 })).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' });
    expect(at({ daysAgo: 1 })).toEqual({ startDateTime: '2026-07-15 00:00:00', endDateTime: '2026-07-16 00:00:00' });
    expect(at({ daysAgo: 2 })).toEqual({ startDateTime: '2026-07-14 00:00:00', endDateTime: '2026-07-15 00:00:00' });
  });

  it('resolves a weekday as the most recent such day, today included', () => {
    // NOW is a Thursday.
    expect(at({ weekday: 'sunday' })).toEqual({ startDateTime: '2026-07-12 00:00:00', endDateTime: '2026-07-13 00:00:00' });
    expect(at({ weekday: 'thursday' })).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' });
  });

  it('resolves an explicit date', () => {
    expect(at({ date: '2026-07-10' })).toEqual({ startDateTime: '2026-07-10 00:00:00', endDateTime: '2026-07-11 00:00:00' });
    expect(at({ date: 'July 10' })).toMatchObject({ error: expect.stringContaining('YYYY-MM-DD') });
    expect(at({ date: '2026-08-01' })).toMatchObject({ error: expect.stringContaining('future') });
  });

  it('resolves the day in the profile timezone, not the runtime zone', () => {
    // 2026-07-16T23:30:00Z is still the 16th in New York but the 17th in Tokyo.
    const crossing = new Date('2026-07-16T23:30:00Z');
    expect(resolveWindow({ daysAgo: 0 }, crossing, 'America/New_York')).toEqual({
      startDateTime: '2026-07-16 00:00:00',
      endDateTime: '2026-07-16 19:30:00',
    });
    expect(resolveWindow({ daysAgo: 0 }, crossing, 'Asia/Tokyo')).toEqual({
      startDateTime: '2026-07-17 00:00:00',
      endDateTime: '2026-07-17 08:30:00',
    });
  });

  it('rejects more than one day picker', () => {
    expect(at({ daysAgo: 1, weekday: 'sunday' })).toMatchObject({ error: expect.stringContaining('only one') });
  });
});

describe('calendar spans (fromDate/toDate)', () => {
  // The case that forced the primitive: "summarize april" was squeezed into
  // {date:"2026-04-01"} and queried one day of a 30-day month (refs #265).
  it('resolves an inclusive month span', () => {
    expect(at({ fromDate: '2026-04-01', toDate: '2026-04-30' })).toEqual({
      startDateTime: '2026-04-01 00:00:00',
      endDateTime: '2026-05-01 00:00:00',
    });
  });

  it('caps a span ending today (or later) at now', () => {
    expect(at({ fromDate: '2026-07-01', toDate: '2026-07-16' })).toEqual({
      startDateTime: '2026-07-01 00:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
    expect(at({ fromDate: '2026-07-01', toDate: '2026-07-31' })).toEqual({
      startDateTime: '2026-07-01 00:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
  });

  it('clamps an over-long month end to the real last day (refs #270)', () => {
    // 2026 is not a leap year: the model's "february" as 02-29 must resolve to
    // the whole month, not error, closing at March 1 midnight.
    expect(at({ fromDate: '2026-02-01', toDate: '2026-02-29' })).toEqual({
      startDateTime: '2026-02-01 00:00:00',
      endDateTime: '2026-03-01 00:00:00',
    });
    // A 31-day April clamps to April 30.
    expect(at({ fromDate: '2026-04-01', toDate: '2026-04-31' })).toEqual({
      startDateTime: '2026-04-01 00:00:00',
      endDateTime: '2026-05-01 00:00:00',
    });
  });

  it('allows one-sided spans', () => {
    expect(at({ fromDate: '2026-07-01' })).toEqual({ startDateTime: '2026-07-01 00:00:00' });
    expect(at({ toDate: '2026-06-30' })).toEqual({ endDateTime: '2026-07-01 00:00:00' });
  });

  it('rejects bad shapes, inverted spans, future starts, and mixed window shapes', () => {
    expect(at({ fromDate: 'april' })).toMatchObject({ error: expect.stringContaining('YYYY-MM-DD') });
    // A calendar-impossible START (not a span end) is still a corrective error,
    // not a NaN throw: the clamp only rescues an over-long toDate, not fromDate.
    expect(at({ fromDate: '2026-02-30' })).toMatchObject({
      error: expect.stringContaining('not a real calendar date'),
    });
    expect(at({ fromDate: '2026-05-10', toDate: '2026-05-01' })).toMatchObject({ error: expect.stringContaining('on or after') });
    expect(at({ fromDate: '2026-08-01' })).toMatchObject({ error: expect.stringContaining('future') });
    expect(at({ fromDate: '2026-04-01', daysAgo: 1 })).toMatchObject({ error: expect.stringContaining('ONE window shape') });
    expect(at({ fromDate: '2026-04-01', toDate: '2026-04-30', fromTime: '16:00' })).toMatchObject({
      error: expect.stringContaining('single day'),
    });
  });
});

describe('weekend (refs #270)', () => {
  // NOW is Thursday 2026-07-16; the most recent Saturday is 2026-07-11.
  it('resolves the most recent weekend, inclusive of Saturday and Sunday', () => {
    expect(at({ weekend: 0 })).toEqual({
      startDateTime: '2026-07-11 00:00:00',
      endDateTime: '2026-07-13 00:00:00',
    });
  });

  it('counts whole weekends back', () => {
    expect(at({ weekend: 1 })).toEqual({
      startDateTime: '2026-07-04 00:00:00',
      endDateTime: '2026-07-06 00:00:00',
    });
  });

  // The schema sends a string enum; resolveWindow maps it to the same
  // weekends-ago arithmetic as the legacy numeric field.
  it('maps the string enum to the same window as the number', () => {
    expect(at({ weekend: 'this' })).toEqual(at({ weekend: 0 }));
    expect(at({ weekend: 'last' })).toEqual(at({ weekend: 1 }));
    expect(at({ weekend: 'two-ago' })).toEqual({
      startDateTime: '2026-06-27 00:00:00',
      endDateTime: '2026-06-29 00:00:00',
    });
  });

  it('caps a weekend still in progress at now', () => {
    // Sunday 2026-07-19 10:30 ET: this weekend started Saturday and has not closed.
    const sunday = new Date('2026-07-19T14:30:00Z');
    expect(resolveWindow({ weekend: 0 }, sunday, 'America/New_York')).toEqual({
      startDateTime: '2026-07-18 00:00:00',
      endDateTime: '2026-07-19 10:30:00',
    });
  });

  it('rejects a negative or fractional weekend and mixing it with another shape', () => {
    expect(at({ weekend: -1 })).toMatchObject({ error: expect.stringContaining('weekend must be 0') });
    expect(at({ weekend: 1.5 })).toMatchObject({ error: expect.stringContaining('weekend must be 0') });
    expect(at({ weekend: 0, daysAgo: 1 })).toMatchObject({ error: expect.stringContaining('ONE window shape') });
  });
});

describe('dayOfMonth ordinal (refs #270)', () => {
  // NOW is 2026-07-16: the most recent 21st is last month's, 2026-06-21.
  it('resolves a bare ordinal to the most recent past day with that number', () => {
    expect(at({ dayOfMonth: 21 })).toEqual({
      startDateTime: '2026-06-21 00:00:00',
      endDateTime: '2026-06-22 00:00:00',
    });
    // The 16th is today, so it is that same day (ends now).
    expect(at({ dayOfMonth: 16 })).toEqual({
      startDateTime: '2026-07-16 00:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
  });

  it('narrows an ordinal day with a clock band', () => {
    expect(at({ dayOfMonth: 21, fromTime: '20:00', toTime: '23:00' })).toEqual({
      startDateTime: '2026-06-21 20:00:00',
      endDateTime: '2026-06-21 23:00:00',
    });
  });

  it('rejects an out-of-range ordinal and mixing it with another day picker', () => {
    expect(at({ dayOfMonth: 0 })).toMatchObject({ error: expect.stringContaining('1-31') });
    expect(at({ dayOfMonth: 32 })).toMatchObject({ error: expect.stringContaining('1-31') });
    expect(at({ dayOfMonth: 21, weekday: 'sunday' })).toMatchObject({ error: expect.stringContaining('only one') });
  });
});

describe('day narrowing', () => {
  it('narrows a single day with fromTime/toTime', () => {
    expect(at({ daysAgo: 1, fromTime: '16:00', toTime: '22:00' })).toEqual({
      startDateTime: '2026-07-15 16:00:00',
      endDateTime: '2026-07-15 22:00:00',
    });
    expect(at({ weekday: 'sunday', fromTime: '09:00' })).toEqual({
      startDateTime: '2026-07-12 09:00:00',
      endDateTime: '2026-07-13 00:00:00',
    });
  });

  it('rejects narrowing without a day, bad clock shapes, and inverted windows', () => {
    expect(at({ fromTime: '16:00' })).toMatchObject({ error: expect.stringContaining('need a day') });
    expect(at({ daysAgo: 1, fromTime: '4pm' })).toMatchObject({ error: expect.stringContaining('HH:MM') });
    expect(at({ daysAgo: 1, fromTime: '22:00', toTime: '16:00' })).toMatchObject({
      error: expect.stringContaining('after'),
    });
  });
});

describe('no window', () => {
  it('returns undefined when no field is set, so the caller reports an unfiltered query', () => {
    expect(at({})).toBeUndefined();
  });
});

/**
 * Refs #434, observed live: "between mon and tue" had no weekday-range shape,
 * so the model computed fromDate/toDate itself and started the window on
 * Sunday. The range is two weekday fields the code resolves: the end is the
 * most recent toWeekday (today included), the start the fromWeekday at or
 * before it. NOW is Thursday 2026-07-16.
 */
describe('weekday ranges', () => {
  it('resolves the most recent such span', () => {
    // Monday Jul 13 through Tuesday Jul 14 (inclusive: closes Wed midnight).
    expect(at({ fromWeekday: 'monday', toWeekday: 'tuesday' })).toEqual({
      startDateTime: '2026-07-13 00:00:00',
      endDateTime: '2026-07-15 00:00:00',
    });
  });

  it('wraps across the weekend', () => {
    // Friday Jul 10 through Monday Jul 13.
    expect(at({ fromWeekday: 'friday', toWeekday: 'monday' })).toEqual({
      startDateTime: '2026-07-10 00:00:00',
      endDateTime: '2026-07-14 00:00:00',
    });
  });

  it('caps the end at now when the span ends today', () => {
    // Wednesday Jul 15 through Thursday Jul 16 (today): closes at now.
    expect(at({ fromWeekday: 'wednesday', toWeekday: 'thursday' })).toEqual({
      startDateTime: '2026-07-15 00:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
  });

  it('rejects a half-open range and unknown day names', () => {
    expect(at({ fromWeekday: 'monday' })).toHaveProperty('error');
    expect(at({ fromWeekday: 'monday', toWeekday: 'blursday' })).toHaveProperty('error');
  });

  it('rejects mixing a weekday range with other day shapes or clock bands', () => {
    expect(at({ fromWeekday: 'monday', toWeekday: 'tuesday', daysAgo: 1 })).toHaveProperty('error');
    expect(at({ fromWeekday: 'monday', toWeekday: 'tuesday', fromTime: '09:00', toTime: '17:00' })).toHaveProperty(
      'error',
    );
  });
});

/** Refs #438: calendar weeks were missing vocabulary, so "this week" forced
 *  the model into date arithmetic. Monday-anchored, resolved in code;
 *  NOW is Thursday 2026-07-16. */
describe('calendar weeks', () => {
  it('resolves this week from Monday through now', () => {
    expect(at({ week: 'this' })).toEqual({
      startDateTime: '2026-07-13 00:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
  });

  it('resolves last week as the previous Monday through Sunday', () => {
    expect(at({ week: 'last' })).toEqual({
      startDateTime: '2026-07-06 00:00:00',
      endDateTime: '2026-07-13 00:00:00',
    });
  });

  it('rejects unknown week values and mixing with other shapes', () => {
    expect(at({ week: 'next' })).toHaveProperty('error');
    expect(at({ week: 'this', daysAgo: 1 })).toHaveProperty('error');
  });
});

/** Refs #449: "this month" on Gemini Nano ran as a rolling 30 days because
 *  the vocabulary had no calendar-month word. Code does the arithmetic;
 *  NOW is Thursday 2026-07-16. */
describe('calendar months', () => {
  it('resolves this month from the 1st through now', () => {
    expect(at({ month: 'this' })).toEqual({
      startDateTime: '2026-07-01 00:00:00',
      endDateTime: '2026-07-16 10:30:00',
    });
  });

  it('resolves last month as the whole previous month', () => {
    expect(at({ month: 'last' })).toEqual({
      startDateTime: '2026-06-01 00:00:00',
      endDateTime: '2026-07-01 00:00:00',
    });
  });

  it('rejects unknown values and mixing with other shapes', () => {
    expect(at({ month: 'next' })).toHaveProperty('error');
    expect(at({ month: 'this', week: 'this' })).toHaveProperty('error');
  });
});
