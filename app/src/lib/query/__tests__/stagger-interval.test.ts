import { describe, expect, it } from 'vitest';
import { staggeredRefetchInterval } from '../stagger-interval';

describe('staggeredRefetchInterval', () => {
  it('index 0 gets exactly the base period, no jitter', () => {
    expect(staggeredRefetchInterval(0, 5, 10000)).toBe(10000);
  });

  it('produces distinct intervals per index', () => {
    const count = 5;
    const base = 10000;
    const intervals = Array.from({ length: count }, (_, i) => staggeredRefetchInterval(i, count, base));
    expect(new Set(intervals).size).toBe(count);
  });

  it('bounds every interval to at most 1.5x the base period', () => {
    const count = 8;
    const base = 20000;
    for (let i = 0; i < count; i++) {
      const interval = staggeredRefetchInterval(i, count, base);
      expect(interval).toBeGreaterThanOrEqual(base);
      expect(interval).toBeLessThanOrEqual(base * 1.5);
    }
  });

  it('single-profile scope (count 1) is unaffected', () => {
    expect(staggeredRefetchInterval(0, 1, 15000)).toBe(15000);
  });
});
