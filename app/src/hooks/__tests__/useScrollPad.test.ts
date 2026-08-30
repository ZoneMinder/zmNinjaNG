import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollPad } from '../useScrollPad';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

describe('useScrollPad', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('is off until the profile says otherwise', () => {
    seedProfiles(['p1'], { current: 'p1' });
    const { result } = renderHook(() => useScrollPad());
    expect(result.current[0]).toBe(false);
  });

  it('remembers the choice against the profile rather than the page visit', () => {
    seedProfiles(['p1'], { current: 'p1' });
    const { result } = renderHook(() => useScrollPad());

    act(() => result.current[1]());

    expect(result.current[0]).toBe(true);
  });

  it('turns a remembered pad back off', () => {
    seedProfiles(['p1'], { current: 'p1', settings: { p1: { showScrollPad: true } } });
    const { result } = renderHook(() => useScrollPad());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
  });

  it('shows for a caller that knows the page needs it, without writing the setting', () => {
    // Montage edit mode: a drag there reorders tiles, so the pad is not a
    // preference. Leaving it on screen must not rewrite what the user chose.
    seedProfiles(['p1'], { current: 'p1' });
    const { result } = renderHook(() => useScrollPad(true));

    expect(result.current[0]).toBe(true);
  });

  it('writes nothing when there is no profile to write to', () => {
    seedProfiles(['p1'], { current: null });
    const { result } = renderHook(() => useScrollPad());

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
  });
});
