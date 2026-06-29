import { describe, it, expect } from 'vitest';
import { resolveBackNavigation } from '../back-navigation';

describe('resolveBackNavigation', () => {
  // Regression: the event back arrow used to navigate(referrer), which pushes a
  // new history entry and mints a new location.key, so the events list rebuilt
  // from the top instead of restoring its scroll position. Esc and the Android
  // back button already pop, which is why only the arrow was broken (refs #197).
  it('pops history when there is a prior entry, even with a referrer set', () => {
    expect(resolveBackNavigation({ referrer: '/events', historyLength: 3 })).toEqual({
      type: 'pop',
    });
  });

  it('pops history when there is a prior entry and no referrer', () => {
    expect(resolveBackNavigation({ historyLength: 2 })).toEqual({ type: 'pop' });
  });

  it('pushes to the referrer when there is no history to pop (cold deep-link)', () => {
    expect(resolveBackNavigation({ referrer: '/timeline', historyLength: 1 })).toEqual({
      type: 'push',
      to: '/timeline',
    });
  });

  it('pushes to /events when there is no history and no referrer', () => {
    expect(resolveBackNavigation({ historyLength: 1 })).toEqual({ type: 'push', to: '/events' });
  });
});
