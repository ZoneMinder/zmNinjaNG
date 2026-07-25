import { describe, it, expect } from 'vitest';
import { computeTicks } from '../timeline-renderer';
import type { FormatSettings } from '../../../lib/format-date-time';

const FMT: FormatSettings = {
  dateFormat: 'MMM d',
  timeFormat: '24h',
  customDateFormat: '',
  customTimeFormat: '',
};

/** Local-time constructor, so the local-midnight major tests stay TZ-independent. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime();

const WIDE = 4000;

describe('computeTicks', () => {
  it('picks the interval from the visible range', () => {
    const start = at(2026, 0, 15, 9);

    const gapMinutes = (ticks: { timeMs: number }[]) =>
      (ticks[1].timeMs - ticks[0].timeMs) / 60_000;

    // 45s of range falls in the 5-second bucket, an hour in the 5-minute one,
    // and a day in the hourly one.
    expect(gapMinutes(computeTicks(start, start + 45_000, WIDE, FMT))).toBeCloseTo(5 / 60);
    expect(gapMinutes(computeTicks(start, start + 60 * 60_000, WIDE, FMT))).toBe(5);
    expect(gapMinutes(computeTicks(start, start + 24 * 3_600_000, WIDE, FMT))).toBe(60);
  });

  it('never emits a tick before the start of the range', () => {
    // 09:37 starts mid-hour, and the hourly interval snaps back to 09:00.
    const start = at(2026, 0, 15, 9, 37);
    const ticks = computeTicks(start, start + 6 * 3_600_000, WIDE, FMT);

    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.min(...ticks.map((t) => t.timeMs))).toBeGreaterThanOrEqual(start);
  });

  it('marks local midnight as major and gives it a weekday label', () => {
    // A day either side of midnight, on the hourly interval.
    const ticks = computeTicks(at(2026, 0, 14, 12), at(2026, 0, 15, 12), WIDE, FMT);
    const midnight = ticks.find((t) => t.timeMs === at(2026, 0, 15));

    expect(midnight).toBeDefined();
    expect(midnight!.isMajor).toBe(true);
    // fmtDateLong is "EEE" plus the date preset, e.g. "Thu Jan 15".
    expect(midnight!.majorLabel).toMatch(/^\w{3} /);

    const noon = ticks.find((t) => t.timeMs === at(2026, 0, 15, 12));
    expect(noon?.isMajor).toBe(false);
    expect(noon?.majorLabel).toBeUndefined();
  });

  it('drops labels that would collide at narrow widths', () => {
    const start = at(2026, 0, 15);
    const end = start + 24 * 3_600_000;

    const wide = computeTicks(start, end, WIDE, FMT);
    const narrow = computeTicks(start, end, 200, FMT);

    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow.length).toBeGreaterThan(0);
  });

  it('keeps surviving labels from overlapping', () => {
    const start = at(2026, 0, 15);
    const ticks = computeTicks(start, start + 12 * 3_600_000, 600, FMT);
    const msPerPx = (12 * 3_600_000) / 600;
    const CHAR_WIDTH_PX = 7;
    const MIN_GAP_PX = 16;

    for (let i = 1; i < ticks.length; i++) {
      const width = (t: (typeof ticks)[number]) =>
        (t.majorLabel ?? t.label).length * CHAR_WIDTH_PX;
      const centre = (t: (typeof ticks)[number]) => (t.timeMs - start) / msPerPx;
      const prevRight = centre(ticks[i - 1]) + width(ticks[i - 1]) / 2;
      const thisLeft = centre(ticks[i]) - width(ticks[i]) / 2;
      expect(thisLeft).toBeGreaterThanOrEqual(prevRight + MIN_GAP_PX);
    }
  });

  it('caps generation so an absurd range cannot run away', () => {
    // Ten years on the daily interval is ~3650 ticks before the 500 cap.
    const start = at(2016, 0, 1);
    const ticks = computeTicks(start, at(2026, 0, 1), 100_000, FMT);
    expect(ticks.length).toBeLessThanOrEqual(500);
  });
});
