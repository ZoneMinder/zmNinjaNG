/**
 * useMonitorMuted: the per-monitor mute choice lives in profile settings so
 * a tile that remounts (route change, group switch, app relaunch) starts in
 * the state the user last chose (refs #463).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { asProfileId } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { useMonitorMuted } from '../useMonitorMuted';

const HOME = asProfileId('home');
const SHED = asProfileId('shed');

describe('useMonitorMuted', () => {
  beforeEach(() => {
    seedProfiles(['home', 'shed'], { current: 'home' });
  });
  afterEach(resetProfileFixture);

  it('starts muted and persists an unmute across remounts', () => {
    const first = renderHook(() => useMonitorMuted(HOME, '1'));
    expect(first.result.current[0]).toBe(true);

    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    expect(useSettingsStore.getState().getProfileSettings(HOME).unmutedMonitorIds).toEqual(['1']);
    first.unmount();

    const second = renderHook(() => useMonitorMuted(HOME, '1'));
    expect(second.result.current[0]).toBe(false);
  });

  it('muting again forgets the monitor', () => {
    const { result } = renderHook(() => useMonitorMuted(HOME, '1'));
    act(() => result.current[1](false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(useSettingsStore.getState().getProfileSettings(HOME).unmutedMonitorIds).toEqual([]);
  });

  it('is scoped to the monitor and the profile', () => {
    const { result } = renderHook(() => useMonitorMuted(HOME, '1'));
    act(() => result.current[1](false));

    expect(renderHook(() => useMonitorMuted(HOME, '2')).result.current[0]).toBe(true);
    expect(renderHook(() => useMonitorMuted(SHED, '1')).result.current[0]).toBe(true);
  });

  it('stays muted with no profile and ignores toggles', () => {
    const { result } = renderHook(() => useMonitorMuted(undefined, '1'));
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(true);
    expect(useSettingsStore.getState().profileSettings).toEqual(
      expect.not.objectContaining({ '': expect.anything() }),
    );
  });
});
