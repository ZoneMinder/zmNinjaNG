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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ProfileSettings } from '../../stores/settings';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useFullscreenMode } from '../useFullscreenMode';
import { useSettingsStore } from '../../stores/settings';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

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
    seedProfiles(['p1']);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
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

    const settings = useSettingsStore.getState().getProfileSettings(PROFILE_ID);
    expect(settings.liveActivityIsFullscreen).toBe(true);
    expect(settings.montageIsFullscreen).toBe(false);
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

    expect(useSettingsStore.getState().getProfileSettings(PROFILE_ID).montageIsFullscreen).toBe(true);
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

    const before = useSettingsStore.getState().profileSettings;
    act(() => result.current.handleToggleFullscreen(true));

    // Reference equality proves updateProfileSettings's set() never ran.
    expect(useSettingsStore.getState().profileSettings).toBe(before);
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

    expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).liveActivityIsFullscreen).toBe(true);
  });
});
