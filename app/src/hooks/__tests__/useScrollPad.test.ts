import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollPad } from '../useScrollPad';

const mocks = vi.hoisted(() => ({
  showScrollPad: { value: false },
  currentProfileId: { value: 'p1' as string | null },
  update: vi.fn(),
}));

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ settings: { showScrollPad: mocks.showScrollPad.value } }),
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (s: { currentProfileId: string | null }) => unknown) =>
    selector({ currentProfileId: mocks.currentProfileId.value }),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (s: { updateProfileSettings: unknown }) => unknown) =>
    selector({ updateProfileSettings: mocks.update }),
}));

describe('useScrollPad', () => {
  beforeEach(() => {
    mocks.showScrollPad.value = false;
    mocks.currentProfileId.value = 'p1';
    mocks.update.mockClear();
  });

  it('is off until the profile says otherwise', () => {
    const { result } = renderHook(() => useScrollPad());
    expect(result.current[0]).toBe(false);
  });

  it('remembers the choice against the profile rather than the page visit', () => {
    const { result } = renderHook(() => useScrollPad());

    act(() => result.current[1]());

    expect(mocks.update).toHaveBeenCalledWith('p1', { showScrollPad: true });
  });

  it('turns a remembered pad back off', () => {
    mocks.showScrollPad.value = true;
    const { result } = renderHook(() => useScrollPad());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(mocks.update).toHaveBeenCalledWith('p1', { showScrollPad: false });
  });

  it('shows for a caller that knows the page needs it, without writing the setting', () => {
    // Montage edit mode: a drag there reorders tiles, so the pad is not a
    // preference. Leaving it on screen must not rewrite what the user chose.
    const { result } = renderHook(() => useScrollPad(true));

    expect(result.current[0]).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('writes nothing when there is no profile to write to', () => {
    mocks.currentProfileId.value = null;
    const { result } = renderHook(() => useScrollPad());

    act(() => result.current[1]());

    expect(mocks.update).not.toHaveBeenCalled();
  });
});
