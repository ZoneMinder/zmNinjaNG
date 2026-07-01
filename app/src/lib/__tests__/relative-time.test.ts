import { describe, it, expect } from 'vitest';
import { dateFnsLocaleFor, isWithinDays, formatEventRelative } from '../relative-time';
import { enUS, de, es, fr, zhCN } from 'date-fns/locale';

// Minimal t stub: returns the key, matching i18next behaviour for a missing value.
const t = ((key: string) => key) as unknown as Parameters<typeof formatEventRelative>[2];

const NOW = new Date('2026-07-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('dateFnsLocaleFor', () => {
  it('maps base language codes to date-fns locales', () => {
    expect(dateFnsLocaleFor('en')).toBe(enUS);
    expect(dateFnsLocaleFor('en-US')).toBe(enUS);
    expect(dateFnsLocaleFor('de')).toBe(de);
    expect(dateFnsLocaleFor('es')).toBe(es);
    expect(dateFnsLocaleFor('fr')).toBe(fr);
    expect(dateFnsLocaleFor('zh')).toBe(zhCN);
  });

  it('falls back to enUS for unknown or missing input', () => {
    expect(dateFnsLocaleFor('xx')).toBe(enUS);
    expect(dateFnsLocaleFor(undefined)).toBe(enUS);
  });
});

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
  it('returns the just-now key under 60s', () => {
    expect(formatEventRelative(ago(30_000), 'en', t, NOW)).toBe('events.just_now');
  });

  it('returns single-unit "ago" strings in English', () => {
    expect(formatEventRelative(ago(40 * MIN), 'en', t, NOW)).toBe('40 minutes ago');
    expect(formatEventRelative(ago(3 * HOUR), 'en', t, NOW)).toBe('3 hours ago');
    expect(formatEventRelative(ago(2 * DAY), 'en', t, NOW)).toBe('2 days ago');
  });

  it('localizes the suffix per language', () => {
    expect(formatEventRelative(ago(40 * MIN), 'es', t, NOW)).toContain('hace');
    expect(formatEventRelative(ago(40 * MIN), 'de', t, NOW)).toContain('vor');
    expect(formatEventRelative(ago(40 * MIN), 'fr', t, NOW)).toContain('il y a');
    expect(formatEventRelative(ago(40 * MIN), 'zh', t, NOW)).toContain('前');
  });
});
