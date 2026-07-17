import { describe, it, expect } from 'vitest';
import { resolveEventRange } from '../event-range';

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
