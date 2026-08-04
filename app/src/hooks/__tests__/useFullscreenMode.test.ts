/**
 * The hook writes whichever fullscreen flag its caller names.
 *
 * It used to hardcode `montageIsFullscreen`, so a second page adopting it
 * would have shared one fullscreen flag with Montage: entering fullscreen on
 * Live Activity would silently have put Montage in fullscreen too (refs #313).
 *
 * `profileId` (not a `Profile` object) so a caller can pass ALL_PROFILES_ID
 * in All mode: the flag then lives in the shared ALL bucket, same as every
 * other All-mode view-level preference (refs #337).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreenMode } from '../useFullscreenMode';
import type { ProfileSettings } from '../../stores/settings';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';

const updateProfileSettings = vi.hoisted(() => vi.fn());

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (s: { updateProfileSettings: unknown }) => unknown) =>
    selector({ updateProfileSettings }),
}));

const PROFILE_ID = asProfileId('p1');

function settingsWith(overrides: Partial<ProfileSettings>): ProfileSettings {
  return {
    montageIsFullscreen: false,
    liveActivityIsFullscreen: false,
    ...overrides,
  } as ProfileSettings;
}

describe('useFullscreenMode', () => {
  beforeEach(() => {
    updateProfileSettings.mockClear();
  });

  it('writes only the settings key it was given', () => {
    const { result } = renderHook(() =>
      useFullscreenMode({
        profileId: PROFILE_ID,
        settings: settingsWith({}),
        settingKey: 'liveActivityIsFullscreen',
      })
    );

    act(() => result.current.handleToggleFullscreen(true));

    expect(updateProfileSettings).toHaveBeenCalledWith('p1', {
      liveActivityIsFullscreen: true,
    });
  });

  it('still writes the montage key for the montage page', () => {
    const { result } = renderHook(() =>
      useFullscreenMode({
        profileId: PROFILE_ID,
        settings: settingsWith({}),
        settingKey: 'montageIsFullscreen',
      })
    );

    act(() => result.current.handleToggleFullscreen(true));

    expect(updateProfileSettings).toHaveBeenCalledWith('p1', { montageIsFullscreen: true });
  });

  it('reports the flag its own key holds, not the other page one', () => {
    const settings = settingsWith({
      montageIsFullscreen: true,
      liveActivityIsFullscreen: false,
    });

    const { result } = renderHook(() =>
      useFullscreenMode({
        profileId: PROFILE_ID,
        settings,
        settingKey: 'liveActivityIsFullscreen',
      })
    );

    expect(result.current.isFullscreen).toBe(false);
  });

  it('writes nothing without a profile to write to', () => {
    const { result } = renderHook(() =>
      useFullscreenMode({
        profileId: null,
        settings: settingsWith({}),
        settingKey: 'liveActivityIsFullscreen',
      })
    );

    act(() => result.current.handleToggleFullscreen(true));

    expect(updateProfileSettings).not.toHaveBeenCalled();
  });

  // All mode: currentProfile is null (useCurrentProfile resolves to null for
  // the ALL_PROFILES_ID sentinel), but the page's raw currentProfileId IS
  // the sentinel - a caller passes that through instead, and the flag lands
  // in the shared ALL bucket rather than being silently dropped.
  it('writes to the ALL bucket when given the ALL_PROFILES_ID sentinel', () => {
    const { result } = renderHook(() =>
      useFullscreenMode({
        profileId: ALL_PROFILES_ID,
        settings: settingsWith({}),
        settingKey: 'liveActivityIsFullscreen',
      })
    );

    act(() => result.current.handleToggleFullscreen(true));

    expect(updateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, {
      liveActivityIsFullscreen: true,
    });
  });
});
