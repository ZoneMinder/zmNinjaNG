import { describe, it, expect } from 'vitest';
import { resolveEventRange, asBareTimeOfDay, hasCalendarDate, singleDayOfRange, parseClockTime, resolveWhen } from '../event-range';

// 2026-07-16T14:30:00Z is 2026-07-16 10:30:00 in America/New_York (EDT,
// UTC-4) and 2026-07-16 23:30:00 in Asia/Tokyo (UTC+9): same UTC instant,
// different local wall-clock hour, both still within 2026-07-16.
const NOW = new Date('2026-07-16T14:30:00Z');

describe('resolveEventRange', () => {
  it('resolves "today" to local midnight..now in the caller\'s timezone', () => {
    const r = resolveEventRange('today', NOW, 'America/New_York');
    expect(r).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' });
  });

  it('resolves "today" using a different timezone\'s own wall-clock hour', () => {
    const r = resolveEventRange('today', NOW, 'Asia/Tokyo');
    expect(r).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 23:30:00' });
  });

  it('resolves "today" onto the correct calendar day even when zones disagree on the date', () => {
    // 2026-07-16T23:30:00Z is 2026-07-16 19:30 in New York but already
    // 2026-07-17 08:30 in Tokyo: the two zones must resolve different days.
    const crossing = new Date('2026-07-16T23:30:00Z');
    expect(resolveEventRange('today', crossing, 'America/New_York')).toEqual({
      startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 19:30:00',
    });
    expect(resolveEventRange('today', crossing, 'Asia/Tokyo')).toEqual({
      startDateTime: '2026-07-17 00:00:00', endDateTime: '2026-07-17 08:30:00',
    });
  });

  it('resolves "yesterday" to local midnight two days back..local midnight today', () => {
    const r = resolveEventRange('yesterday', NOW, 'America/New_York');
    expect(r).toEqual({ startDateTime: '2026-07-15 00:00:00', endDateTime: '2026-07-16 00:00:00' });
  });

  it('resolves "last_hour" as a rolling window, not a calendar boundary', () => {
    const r = resolveEventRange('last_hour', NOW, 'America/New_York');
    expect(r).toEqual({ startDateTime: '2026-07-16 09:30:00', endDateTime: '2026-07-16 10:30:00' });
  });

  it('resolves "last_24h" as now minus 24 hours', () => {
    const r = resolveEventRange('last_24h', NOW, 'America/New_York');
    expect(r).toEqual({ startDateTime: '2026-07-15 10:30:00', endDateTime: '2026-07-16 10:30:00' });
  });

  it('resolves "last_7d" as now minus 7 days', () => {
    const r = resolveEventRange('last_7d', NOW, 'America/New_York');
    expect(r).toEqual({ startDateTime: '2026-07-09 10:30:00', endDateTime: '2026-07-16 10:30:00' });
  });

  it('resolves "last_30d" as now minus 30 days', () => {
    const r = resolveEventRange('last_30d', NOW, 'America/New_York');
    expect(r).toEqual({ startDateTime: '2026-06-16 10:30:00', endDateTime: '2026-07-16 10:30:00' });
  });
});

describe('time-of-day bounds', () => {
  it('normalizes a bare time, with or without seconds', () => {
    expect(asBareTimeOfDay('16:00')).toBe('16:00:00');
    expect(asBareTimeOfDay('4:05:30')).toBe('04:05:30');
    expect(asBareTimeOfDay(' 22:00 ')).toBe('22:00:00');
  });

  it('rejects anything that is not a plain wall-clock time', () => {
    expect(asBareTimeOfDay('4pm')).toBeUndefined();
    expect(asBareTimeOfDay('24:00')).toBeUndefined();
    expect(asBareTimeOfDay('16:60')).toBeUndefined();
    expect(asBareTimeOfDay('2026-07-18 16:00:00')).toBeUndefined();
    expect(asBareTimeOfDay('yesterday')).toBeUndefined();
  });

  it('recognizes values that carry their own date', () => {
    expect(hasCalendarDate('2026-07-18')).toBe(true);
    expect(hasCalendarDate('2026-07-18 16:00:00')).toBe(true);
    expect(hasCalendarDate('2026-07-18T16:00:00Z')).toBe(true);
    expect(hasCalendarDate('16:00')).toBe(false);
    expect(hasCalendarDate('last tuesday')).toBe(false);
  });

  // Only a calendar-aligned range names one day, so only those can anchor a
  // bare time: "4pm" inside "last 7 days" is not a moment.
  it('gives a day only for the calendar-day ranges', () => {
    const yesterday = resolveEventRange('yesterday', NOW, 'America/New_York');
    expect(singleDayOfRange('yesterday', yesterday)).toBe('2026-07-15');

    const today = resolveEventRange('today', NOW, 'America/New_York');
    expect(singleDayOfRange('today', today)).toBe('2026-07-16');

    const rolling = resolveEventRange('last_7d', NOW, 'America/New_York');
    expect(singleDayOfRange('last_7d', rolling)).toBeUndefined();
  });
});

// NOW is 2026-07-16 10:30:00 in America/New_York, so "yesterday" is the 15th.
describe('resolveWhen (English time windows)', () => {
  const when = (phrase: string) => resolveWhen(phrase, NOW, 'America/New_York');

  it('reads clock times the way people write them', () => {
    expect(parseClockTime('4pm')).toBe(16 * 60);
    expect(parseClockTime('4:30pm')).toBe(16 * 60 + 30);
    expect(parseClockTime('16:00')).toBe(16 * 60);
    expect(parseClockTime('noon')).toBe(12 * 60);
    expect(parseClockTime('midnight')).toBe(0);
    expect(parseClockTime('12am')).toBe(0);
    expect(parseClockTime('12pm')).toBe(12 * 60);
    expect(parseClockTime('half past four')).toBeUndefined();
    expect(parseClockTime('25:00')).toBeUndefined();
  });

  it('resolves whole days', () => {
    expect(when('today')).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' });
    expect(when('yesterday')).toEqual({ startDateTime: '2026-07-15 00:00:00', endDateTime: '2026-07-16 00:00:00' });
  });

  it('resolves rolling windows', () => {
    expect(when('last hour')).toEqual({ startDateTime: '2026-07-16 09:30:00', endDateTime: '2026-07-16 10:30:00' });
    expect(when('last 24 hours')).toEqual({ startDateTime: '2026-07-15 10:30:00', endDateTime: '2026-07-16 10:30:00' });
    expect(when('past 30 minutes')).toEqual({ startDateTime: '2026-07-16 10:00:00', endDateTime: '2026-07-16 10:30:00' });
    expect(when('last 7 days')).toEqual({ startDateTime: '2026-07-09 10:30:00', endDateTime: '2026-07-16 10:30:00' });
  });

  // The case that started this: the model only has to echo the user's phrase.
  it('resolves part of a named day', () => {
    expect(when('yesterday from 4pm to 10pm')).toEqual({
      startDateTime: '2026-07-15 16:00:00',
      endDateTime: '2026-07-15 22:00:00',
    });
    expect(when('today between 9am and noon')).toEqual({
      startDateTime: '2026-07-16 09:00:00',
      endDateTime: '2026-07-16 12:00:00',
    });
    expect(when('yesterday 16:00 to 22:00')).toEqual({
      startDateTime: '2026-07-15 16:00:00',
      endDateTime: '2026-07-15 22:00:00',
    });
  });

  it('resolves one-sided windows', () => {
    expect(when('yesterday after 4pm')).toEqual({
      startDateTime: '2026-07-15 16:00:00',
      endDateTime: '2026-07-16 00:00:00',
    });
    expect(when('today before noon')).toEqual({
      startDateTime: '2026-07-16 00:00:00',
      endDateTime: '2026-07-16 12:00:00',
    });
  });

  // Errors, not guesses: each names what could not be read so the model can
  // correct rather than retry the same phrase.
  it('reports what it could not read instead of guessing', () => {
    expect(when('')).toMatchObject({ error: expect.stringContaining('empty') });
    expect(when('sometime last spring')).toMatchObject({ error: expect.stringContaining('Could not read') });
    expect(when('yesterday from 4pm to bananas')).toMatchObject({ error: expect.stringContaining('bananas') });
    expect(when('yesterday from 10pm to 4pm')).toMatchObject({ error: expect.stringContaining('not after') });
  });
});
