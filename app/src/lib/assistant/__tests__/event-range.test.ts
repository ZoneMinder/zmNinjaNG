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
    expect(at({ lastCount: 1, lastUnit: 'day', daysAgo: 1 })).toMatchObject({ error: expect.stringContaining('not both') });
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
