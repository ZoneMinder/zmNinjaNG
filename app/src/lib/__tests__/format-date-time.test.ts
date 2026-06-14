import { describe, it, expect } from 'vitest';
import { formatAppWeekday } from '../format-date-time';

describe('formatAppWeekday', () => {
  it('returns the short weekday name for a known date', () => {
    // 2024-01-01 (noon local, so timezone cannot shift the day) is a Monday.
    expect(formatAppWeekday(new Date(2024, 0, 1, 12, 0, 0))).toBe('Mon');
    // 2024-01-06 is a Saturday.
    expect(formatAppWeekday(new Date(2024, 0, 6, 12, 0, 0))).toBe('Sat');
  });
});
