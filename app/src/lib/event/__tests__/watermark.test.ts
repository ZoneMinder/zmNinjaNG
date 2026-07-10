import { describe, expect, it } from 'vitest';
import { nextSecondAfter } from '../watermark';

describe('nextSecondAfter', () => {
  it('adds one second to a normal timestamp', () => {
    expect(nextSecondAfter('2026-07-10 08:49:37')).toBe('2026-07-10T08:49:38');
  });

  it('rolls over across a minute boundary', () => {
    expect(nextSecondAfter('2026-07-10 08:49:59')).toBe('2026-07-10T08:50:00');
  });

  it('rolls over across an hour boundary', () => {
    expect(nextSecondAfter('2026-07-10 08:59:59')).toBe('2026-07-10T09:00:00');
  });

  it('rolls over across midnight', () => {
    expect(nextSecondAfter('2026-07-10 23:59:59')).toBe('2026-07-11T00:00:00');
  });

  it('returns a malformed string unchanged', () => {
    expect(nextSecondAfter('not-a-date')).toBe('not-a-date');
  });
});
