import { describe, it, expect } from 'vitest';
import { isWithinDays, formatEventRelative } from '../relative-time';

// Minimal t stub: returns the key, matching i18next behaviour for a missing value.
const t = ((key: string) => key) as unknown as Parameters<typeof formatEventRelative>[2];

const NOW = new Date('2026-07-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('isWithinDays', () => {
  it('is true inside the window', () => {
    expect(isWithinDays(ago(MIN), 7, NOW)).toBe(true);
    expect(isWithinDays(ago(6 * DAY), 7, NOW)).toBe(true);
  });
  it('is true at the exact boundary', () => {
    expect(isWithinDays(ago(7 * DAY), 7, NOW)).toBe(true);
  });
  it('is false outside the window', () => {
    expect(isWithinDays(ago(8 * DAY), 7, NOW)).toBe(false);
  });
  it('is false for a future date', () => {
    expect(isWithinDays(new Date(NOW.getTime() + MIN), 7, NOW)).toBe(false);
  });
});

describe('formatEventRelative', () => {
  it('returns the now key under 60s', () => {
    expect(formatEventRelative(ago(30_000), 'en', t, NOW)).toBe('events.now');
  });

  it('returns the now key for a future date within 60s', () => {
    expect(formatEventRelative(new Date(NOW.getTime() + 30_000), 'en', t, NOW)).toBe('events.now');
  });

  it('returns narrow-style "ago" strings in English', () => {
    expect(formatEventRelative(ago(40 * MIN), 'en', t, NOW)).toBe('40m ago');
    expect(formatEventRelative(ago(3 * HOUR), 'en', t, NOW)).toBe('3h ago');
    expect(formatEventRelative(ago(2 * DAY), 'en', t, NOW)).toBe('2d ago');
  });

  it('localizes the suffix per language', () => {
    expect(formatEventRelative(ago(40 * MIN), 'es', t, NOW)).toContain('hace');
    expect(formatEventRelative(ago(40 * MIN), 'de', t, NOW)).toContain('vor');
    expect(formatEventRelative(ago(40 * MIN), 'zh', t, NOW)).toContain('前');
  });

  it('falls back to short style for French so "ago" is spelled, not a bare minus', () => {
    const fr = formatEventRelative(ago(40 * MIN), 'fr', t, NOW);
    expect(fr).toContain('il y a');
    expect(fr.trim().startsWith('-')).toBe(false);
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatEventRelative(new Date('not-a-date'), 'en', t, NOW)).toBe('');
  });
});
