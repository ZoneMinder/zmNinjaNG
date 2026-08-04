import { describe, it, expect } from 'vitest';
import { capWatchedRoundRobin } from '../live-activity';

describe('capWatchedRoundRobin', () => {
  it('passes everything through untouched when the total is under the cap', () => {
    const { watched, overflowCount } = capWatchedRoundRobin([['a', 'b'], ['c']], 10);
    expect(watched).toEqual(['a', 'b', 'c']);
    expect(overflowCount).toBe(0);
  });

  it('distributes the cap round-robin so no single profile is starved', () => {
    // 3 profiles with uneven counts: 5, 1, 3 (total 9), capped to 4. A
    // profile-order truncation would take all 4 from the first group alone;
    // round-robin instead takes one from each group per pass.
    const groups = [
      ['a1', 'a2', 'a3', 'a4', 'a5'],
      ['b1'],
      ['c1', 'c2', 'c3'],
    ];
    const { watched, overflowCount } = capWatchedRoundRobin(groups, 4);
    expect(watched).toEqual(['a1', 'b1', 'c1', 'a2']);
    expect(overflowCount).toBe(5);
  });

  it('skips an exhausted group and keeps drawing from the rest', () => {
    const groups = [['a1'], ['b1', 'b2', 'b3']];
    const { watched, overflowCount } = capWatchedRoundRobin(groups, 3);
    expect(watched).toEqual(['a1', 'b1', 'b2']);
    expect(overflowCount).toBe(1);
  });

  it('handles an empty group list', () => {
    expect(capWatchedRoundRobin([], 5)).toEqual({ watched: [], overflowCount: 0 });
  });

  it('is deterministic across repeated calls with the same input', () => {
    const groups = [['a1', 'a2'], ['b1', 'b2', 'b3']];
    const first = capWatchedRoundRobin(groups, 3);
    const second = capWatchedRoundRobin(groups, 3);
    expect(second).toEqual(first);
  });
});
