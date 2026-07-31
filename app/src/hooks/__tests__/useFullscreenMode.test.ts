/**
 * The hook writes whichever fullscreen flag its caller names.
 *
 * It used to hardcode `montageIsFullscreen`, so a second page adopting it
 * would have shared one fullscreen flag with Montage: entering fullscreen on
 * Live Activity would silently have put Montage in fullscreen too (refs #313).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreenMode } from '../useFullscreenMode';
import type { ProfileSettings } from '../../stores/settings';
import type { Profile } from '../../api/types';

const updateProfileSettings = vi.hoisted(() => vi.fn());

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (s: { updateProfileSettings: unknown }) => unknown) =>
    selector({ updateProfileSettings }),
}));

const PROFILE = { id: 'p1' } as Profile;

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
        currentProfile: PROFILE,
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
        currentProfile: PROFILE,
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
        currentProfile: PROFILE,
        settings,
        settingKey: 'liveActivityIsFullscreen',
      })
    );

    expect(result.current.isFullscreen).toBe(false);
  });

  it('writes nothing without a profile to write to', () => {
    const { result } = renderHook(() =>
      useFullscreenMode({
        currentProfile: null,
        settings: settingsWith({}),
        settingKey: 'liveActivityIsFullscreen',
      })
    );

    act(() => result.current.handleToggleFullscreen(true));

    expect(updateProfileSettings).not.toHaveBeenCalled();
  });
});
