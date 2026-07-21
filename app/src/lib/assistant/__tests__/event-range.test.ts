import { describe, it, expect } from 'vitest';
import { parseClockTime, resolveWhen } from '../event-range';

// 2026-07-16T14:30:00Z is 2026-07-16 10:30:00 in America/New_York (EDT,
// UTC-4) and 2026-07-16 23:30:00 in Asia/Tokyo (UTC+9): same UTC instant,
// different local wall-clock hour, both still within 2026-07-16.
const NOW = new Date('2026-07-16T14:30:00Z');

describe('resolveWhen timezone handling', () => {
  it('resolves "today" using a different timezone\'s own wall-clock hour', () => {
    const r = resolveWhen('today', NOW, 'Asia/Tokyo');
    expect(r).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 23:30:00' });
  });

  it('resolves "today" onto the correct calendar day even when zones disagree on the date', () => {
    // 2026-07-16T23:30:00Z is 2026-07-16 19:30 in New York but already
    // 2026-07-17 08:30 in Tokyo: the two zones must resolve different days.
    const crossing = new Date('2026-07-16T23:30:00Z');
    expect(resolveWhen('today', crossing, 'America/New_York')).toEqual({
      startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 19:30:00',
    });
    expect(resolveWhen('today', crossing, 'Asia/Tokyo')).toEqual({
      startDateTime: '2026-07-17 00:00:00', endDateTime: '2026-07-17 08:30:00',
    });
  });

  // The keywords the retired `range` enum used, still understood in case a
  // model repeats one from a persisted thread (see resolveWhen's LEGACY map).
  it('still resolves the legacy enum keywords', () => {
    expect(resolveWhen('last_24h', NOW, 'America/New_York')).toEqual({
      startDateTime: '2026-07-15 10:30:00', endDateTime: '2026-07-16 10:30:00',
    });
    expect(resolveWhen('last_7d', NOW, 'America/New_York')).toEqual({
      startDateTime: '2026-07-09 10:30:00', endDateTime: '2026-07-16 10:30:00',
    });
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

  // The two phrasings live use rejected first (refs #262). NOW is Thursday
  // 2026-07-16, so "2 days ago" is Tuesday the 14th and the most recent
  // Sunday is the 12th.
  it('resolves "N days ago" as that calendar day', () => {
    expect(when('2 days ago')).toEqual({ startDateTime: '2026-07-14 00:00:00', endDateTime: '2026-07-15 00:00:00' });
    expect(when('1 day ago')).toEqual({ startDateTime: '2026-07-15 00:00:00', endDateTime: '2026-07-16 00:00:00' });
  });

  it('resolves weekday names as the most recent such day', () => {
    const sunday = { startDateTime: '2026-07-12 00:00:00', endDateTime: '2026-07-13 00:00:00' };
    expect(when('sunday')).toEqual(sunday);
    expect(when('on sunday')).toEqual(sunday);
    expect(when('last sunday')).toEqual(sunday);
  });

  // A bare weekday that IS today means today; only "last" reaches back a week.
  it('distinguishes "thursday" (today) from "last thursday" when asked on a Thursday', () => {
    expect(when('thursday')).toEqual({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' });
    expect(when('last thursday')).toEqual({ startDateTime: '2026-07-09 00:00:00', endDateTime: '2026-07-10 00:00:00' });
  });

  it('composes a weekday with part-of-day narrowing', () => {
    expect(when('sunday from 4pm to 10pm')).toEqual({
      startDateTime: '2026-07-12 16:00:00',
      endDateTime: '2026-07-12 22:00:00',
    });
    expect(when('2 days ago after 9am')).toEqual({
      startDateTime: '2026-07-14 09:00:00',
      endDateTime: '2026-07-15 00:00:00',
    });
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
