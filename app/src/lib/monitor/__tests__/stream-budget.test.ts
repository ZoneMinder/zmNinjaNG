/**
 * Edge cases of the All-mode stream budget the Montage page tests do not
 * reach: uneven server sizes, an exhausted server, and the no-op paths.
 * The even split and the odd-slot tiebreak are asserted where users see
 * them, in Montage.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { allocateStreamBudget } from '../stream-budget';

interface Tile {
  id: string;
  profileId: string;
}

const tiles = (profileId: string, count: number): Tile[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${profileId}-${i}`, profileId }));

const ids = (items: Tile[]) => items.map((item) => item.id);
const budget = (items: Tile[], max: number) =>
  allocateStreamBudget(items, max, (item) => item.profileId);

describe('allocateStreamBudget', () => {
  it('gives a small server everything it has and spends the rest on the big one', () => {
    // An even split would leave a slot unused: server "a" runs out after one
    // monitor, so the budget of four buys three tiles from "b".
    expect(ids(budget([...tiles('a', 1), ...tiles('b', 9)], 4))).toEqual([
      'a-0',
      'b-0',
      'b-1',
      'b-2',
    ]);
  });

  it('spends the whole budget when servers are lopsided in the other direction', () => {
    const kept = budget([...tiles('a', 6), ...tiles('b', 1), ...tiles('c', 6)], 5);
    expect(ids(kept)).toEqual(['a-0', 'a-1', 'b-0', 'c-0', 'c-1']);
  });

  it('returns the input untouched when everything fits', () => {
    const items = [...tiles('a', 2), ...tiles('b', 2)];
    // Identity, not a copy: the caller memoizes on it.
    expect(budget(items, 4)).toBe(items);
  });

  it('keeps nothing on a budget of zero', () => {
    expect(budget([...tiles('a', 3)], 0)).toEqual([]);
  });
});
