import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCurrentProfile } from '../useCurrentProfile';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../stores/settings';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { seedProfiles, resetProfileFixture, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

describe('useCurrentProfile', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('returns null profile when no profile is selected', () => {
    seedProfiles(['profile-1'], { current: null });

    const { result } = renderHook(() => useCurrentProfile());

    expect(result.current.currentProfile).toBeNull();
    expect(result.current.hasProfile).toBe(false);
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the current profile when one is selected', () => {
    seedProfiles(['profile-1', 'profile-2'], { current: 'profile-1' });

    const { result } = renderHook(() => useCurrentProfile());

    // Compared against the live store entry rather than seedProfiles'
    // returned snapshot: setting an auth token for 'profile-1' also fires the
    // profile store's auth-subscribe effect, which stamps refreshToken onto
    // the stored profile object after seeding returns.
    const stored = useProfileStore.getState().profiles.find((p) => p.id === asProfileId('profile-1'));
    expect(result.current.currentProfile).toEqual(stored);
    expect(result.current.hasProfile).toBe(true);
  });

  it('merges profile settings with defaults', () => {
    seedProfiles(['profile-1'], {
      current: 'profile-1',
      settings: { 'profile-1': { viewMode: 'streaming', streamMaxFps: 15 } },
    });

    const { result } = renderHook(() => useCurrentProfile());

    // Custom settings should override defaults
    expect(result.current.settings.viewMode).toBe('streaming');
    expect(result.current.settings.streamMaxFps).toBe(15);
    // Defaults should be preserved for non-overridden values
    expect(result.current.settings.snapshotRefreshInterval).toBe(3);
    expect(result.current.settings.montageByGroup).toEqual({});
  });

  it('returns correct profile when switching profiles', () => {
    const profiles = seedProfiles(['profile-1', 'profile-2'], { current: 'profile-1' });

    const { result, rerender } = renderHook(() => useCurrentProfile());

    expect(result.current.currentProfile?.id).toBe(profiles[0].id);
    expect(result.current.currentProfile?.name).toBe(profiles[0].name);

    // Switch to profile 2
    useProfileStore.setState({ currentProfileId: profiles[1].id });
    rerender();

    expect(result.current.currentProfile?.id).toBe(profiles[1].id);
    expect(result.current.currentProfile?.name).toBe(profiles[1].name);
  });

  it('returns null when current profile ID does not match any profile', () => {
    seedProfiles(['profile-1'], { current: 'non-existent-profile' });

    const { result } = renderHook(() => useCurrentProfile());

    expect(result.current.currentProfile).toBeNull();
    expect(result.current.hasProfile).toBe(false);
  });

  it('handles empty profiles array', () => {
    seedProfiles([], { current: 'profile-1' });

    const { result } = renderHook(() => useCurrentProfile());

    expect(result.current.currentProfile).toBeNull();
    expect(result.current.hasProfile).toBe(false);
  });

  it('handles undefined profileSettings gracefully', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    // Guards against corrupted persisted state: the real store never
    // initializes profileSettings to undefined, but a hand-edited or
    // partially-migrated localStorage blob could rehydrate one.
    useSettingsStore.setState({ profileSettings: undefined as never });

    const { result } = renderHook(() => useCurrentProfile());

    // Should not throw, should return defaults
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('handles null profiles array gracefully', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    // Same defense as above, for the profile store's own list.
    useProfileStore.setState({ profiles: null as never });

    const { result } = renderHook(() => useCurrentProfile());

    // Should not throw, should return null
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.hasProfile).toBe(false);
  });

  it('isAllMode is false for a real profile selection', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });

    const { result } = renderHook(() => useCurrentProfile());

    expect(result.current.isAllMode).toBe(false);
  });

  it('isAllMode is true for the ALL_PROFILES_ID sentinel, with currentProfile and hasProfile unaffected', () => {
    seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });

    const { result } = renderHook(() => useCurrentProfile());

    expect(result.current.isAllMode).toBe(true);
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.hasProfile).toBe(false);
  });

  // A group aggregates the same way, so every surface that branches on this
  // flag treats it the same way; the flag says "aggregating", not "which
  // aggregate" (refs #337).
  it('isAllMode is true for a group id, with currentProfile and hasProfile unaffected', () => {
    seedProfiles(['profile-1'], { current: mintVirtualProfileId() });

    const { result } = renderHook(() => useCurrentProfile());

    expect(result.current.isAllMode).toBe(true);
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.hasProfile).toBe(false);
  });
});
