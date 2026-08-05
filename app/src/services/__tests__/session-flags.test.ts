import { beforeEach, describe, expect, it } from 'vitest';
import {
  markSessionActive,
  markSessionInactive,
  markAllSessionsInactive,
  hasActiveSession,
} from '../session-flags';

describe('session-flags', () => {
  beforeEach(() => {
    markAllSessionsInactive();
  });

  it('is false for a profile that was never marked active', () => {
    expect(hasActiveSession('p1')).toBe(false);
  });

  it('becomes true after markSessionActive and false again after markSessionInactive', () => {
    markSessionActive('p1');
    expect(hasActiveSession('p1')).toBe(true);

    markSessionInactive('p1');
    expect(hasActiveSession('p1')).toBe(false);
  });

  it('tracks each profile independently', () => {
    markSessionActive('p1');
    expect(hasActiveSession('p1')).toBe(true);
    expect(hasActiveSession('p2')).toBe(false);
  });

  it('markAllSessionsInactive clears every profile', () => {
    markSessionActive('p1');
    markSessionActive('p2');

    markAllSessionsInactive();

    expect(hasActiveSession('p1')).toBe(false);
    expect(hasActiveSession('p2')).toBe(false);
  });
});
