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

describe('capWatchedRoundRobin resident exemption', () => {
  // A resident item is one still mid-alarm and on screen (Live Activity's
  // dwell window hasn't released it). A re-slice that drops one with no
  // dwell at all is the #313 failure mode reached through the cap instead
  // of the poll: CMD_QUIT + remount thrash for a tile the user is looking
  // at right now.
  it('keeps a resident item even when the plain round-robin would drop it', () => {
    const groups = [
      ['a0', 'a1', 'a2', 'a3', 'a4'], // 5
      ['b0'], // 1
    ];
    // Unexempted, capping to 3 takes a0, b0, a1 - "a4" never appears.
    const plain = capWatchedRoundRobin(groups, 3);
    expect(plain.watched).not.toContain('a4');

    const { watched, overflowCount } = capWatchedRoundRobin(groups, 3, {
      keyOf: (x) => x,
      keys: new Set(['a4']),
    });
    expect(watched).toContain('a4');
    expect(watched).toHaveLength(3);
    expect(overflowCount).toBe(3); // 6 total - 3 watched
  });

  it('still enforces the cap for everything else around the resident exemption', () => {
    const groups = [['a0', 'a1', 'a2'], ['b0', 'b1', 'b2']];
    const { watched } = capWatchedRoundRobin(groups, 2, { keyOf: (x) => x, keys: new Set(['a2']) });
    expect(watched).toContain('a2');
    expect(watched).toHaveLength(2);
  });

  it('is a no-op when nothing is resident, matching the unexempted cap exactly', () => {
    const groups = [['a0', 'a1', 'a2'], ['b0']];
    const plain = capWatchedRoundRobin(groups, 2);
    const exempted = capWatchedRoundRobin(groups, 2, { keyOf: (x) => x, keys: new Set() });
    expect(exempted).toEqual(plain);
  });

  it('lets resident items alone exceed the nominal cap rather than dropping any of them', () => {
    // Edge case: every currently-watched item happens to be resident at
    // once. The cap is a fan-out guardrail, not a hard ceiling on already-
    // alarming tiles, so nothing gets evicted.
    const groups = [['a0', 'a1', 'a2']];
    const { watched, overflowCount } = capWatchedRoundRobin(groups, 2, {
      keyOf: (x) => x,
      keys: new Set(['a0', 'a1', 'a2']),
    });
    expect(watched).toEqual(['a0', 'a1', 'a2']);
    expect(overflowCount).toBe(0);
  });
});
