import { describe, it, expect } from 'vitest';
import {
  clampRecentEventsCount,
  isMonitorRecentEventsHidden,
  toggleMonitorRecentEventsHidden,
} from '../monitor-recent-events';

describe('clampRecentEventsCount', () => {
  it('clamps below min up to min', () => {
    expect(clampRecentEventsCount(0)).toBe(1);
    expect(clampRecentEventsCount(-5)).toBe(1);
  });
  it('clamps above max down to max', () => {
    expect(clampRecentEventsCount(999)).toBe(20);
  });
  it('rounds fractional values', () => {
    expect(clampRecentEventsCount(4.6)).toBe(5);
  });
  it('falls back to default for non-finite input', () => {
    expect(clampRecentEventsCount(NaN)).toBe(5);
    expect(clampRecentEventsCount(undefined as unknown as number)).toBe(5);
  });
  it('passes through an in-range value', () => {
    expect(clampRecentEventsCount(8)).toBe(8);
  });
});

describe('hidden set helpers', () => {
  it('reports membership', () => {
    expect(isMonitorRecentEventsHidden(['3', '7'], '7')).toBe(true);
    expect(isMonitorRecentEventsHidden(['3', '7'], '9')).toBe(false);
  });
  it('adds a monitor id when absent', () => {
    expect(toggleMonitorRecentEventsHidden(['3'], '7')).toEqual(['3', '7']);
  });
  it('removes a monitor id when present', () => {
    expect(toggleMonitorRecentEventsHidden(['3', '7'], '7')).toEqual(['3']);
  });
  it('does not mutate the input array', () => {
    const input = ['3'];
    toggleMonitorRecentEventsHidden(input, '7');
    expect(input).toEqual(['3']);
  });
});
