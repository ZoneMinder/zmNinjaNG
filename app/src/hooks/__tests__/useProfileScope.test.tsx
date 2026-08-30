import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProfileScope } from '../useProfileScope';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { seedProfiles, resetProfileFixture, makeProfile, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

/** Adds a raw settings bucket for an id seedProfiles doesn't seed (an
 *  aggregate id, real or virtual), merging with whatever seedProfiles already
 *  wrote so the seeded profiles' own buckets survive. */
function seedAggregateSettings(bucketId: string, settings: Record<string, unknown>) {
  useSettingsStore.setState({
    profileSettings: { ...useSettingsStore.getState().profileSettings, [bucketId]: settings as never },
  });
}

describe('useProfileScope', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('returns single mode with the profile and its own settings', () => {
    seedProfiles(['profile-1', 'profile-2'], {
      current: 'profile-1',
      settings: { 'profile-1': { streamMaxFps: 15 } },
    });

    const { result } = renderHook(() => useProfileScope());

    // Compared against the live store entry, not seedProfiles' returned
    // snapshot: setting an auth token for the current profile also fires the
    // profile store's auth-subscribe effect, which stamps refreshToken onto
    // it after seeding returns.
    const stored = useProfileStore.getState().profiles.find((p) => p.id === asProfileId('profile-1'));
    expect(result.current?.mode).toBe('single');
    expect(result.current?.profile).toEqual(stored);
    expect(result.current?.profiles).toEqual([stored]);
    expect(result.current?.settings.streamMaxFps).toBe(15);
  });

  it('returns all mode with every profile and the ALL settings bucket', () => {
    const profiles = seedProfiles(['profile-1', 'profile-2'], { current: ALL_PROFILES_ID });
    seedAggregateSettings(ALL_PROFILES_ID, { streamMaxFps: 42 });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profile).toBeNull();
    expect(result.current?.profiles).toEqual(profiles);
    // Value round-trip: a setting written to the ALL bucket comes back.
    expect(result.current?.settings.streamMaxFps).toBe(42);
  });

  it('returns null when no profiles are selected', () => {
    seedProfiles([], { current: null });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  it('returns null when currentProfileId matches no profile', () => {
    seedProfiles(['profile-1'], { current: 'non-existent-profile' });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  it('returns null when the ALL_PROFILES_ID sentinel is selected with no profiles left', () => {
    // Deleting profiles one-by-one while in All mode leaves the sentinel
    // selected with an empty profiles list (deleteProfile only resets
    // currentProfileId when it equals the deleted id, never for the
    // sentinel). null must mean "route to setup" here too.
    seedProfiles([], { current: ALL_PROFILES_ID });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  it('is not in all mode for a single-profile selection', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('single');
  });

  it('is in all mode for the ALL_PROFILES_ID sentinel', () => {
    seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
  });

  // refs #337: profile disable toggle
  it('excludes a disabled profile from the All mode profiles list', () => {
    const profiles = seedProfiles(['profile-1', makeProfile('profile-2', { disabled: true })], {
      current: ALL_PROFILES_ID,
    });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profiles).toEqual([profiles[0]]);
  });

  it('is still All mode with a single enabled profile left after filtering (existing mode semantics)', () => {
    seedProfiles(['profile-1', makeProfile('profile-2', { disabled: true })], { current: ALL_PROFILES_ID });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profiles).toHaveLength(1);
  });

  it('treats a disabled persisted current profile as null scope', () => {
    seedProfiles([makeProfile('profile-1', { disabled: true }), 'profile-2'], { current: 'profile-1' });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  // refs #337: virtual profiles - a named group aggregates like All Servers
  // over its own members.
  describe('virtual profiles', () => {
    const VIRTUAL_ID = mintVirtualProfileId();
    const group = (memberProfileIds: string[]) => ({
      id: VIRTUAL_ID,
      name: 'Upstairs',
      memberProfileIds: memberProfileIds.map(asProfileId),
    });

    it('aggregates over the group members only', () => {
      const profiles = seedProfiles(['profile-1', 'profile-2'], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [group(['profile-2'])] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.mode).toBe('all');
      expect(result.current?.profiles).toEqual([profiles[1]]);
      expect(result.current?.profile).toBeNull();
    });

    it('names the aggregate so consumers can label it', () => {
      seedProfiles(['profile-1', 'profile-2'], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [group(['profile-1', 'profile-2'])] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.mode === 'all' && result.current.aggregateId).toBe(VIRTUAL_ID);
      expect(result.current?.mode === 'all' && result.current.aggregateName).toBe('Upstairs');
    });

    it('leaves All Servers unnamed, so consumers use the localized label', () => {
      seedProfiles(['profile-1'], { current: ALL_PROFILES_ID });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.mode === 'all' && result.current.aggregateId).toBe(ALL_PROFILES_ID);
      expect(result.current?.mode === 'all' && result.current.aggregateName).toBeNull();
    });

    it('reads the group\'s own settings bucket, not the All bucket', () => {
      seedProfiles(['profile-1', 'profile-2'], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [group(['profile-1'])] });
      seedAggregateSettings(VIRTUAL_ID, { streamMaxFps: 11 });
      seedAggregateSettings(ALL_PROFILES_ID, { streamMaxFps: 42 });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.settings.streamMaxFps).toBe(11);
    });

    it('filters a disabled member out of the group', () => {
      const profiles = seedProfiles(['profile-1', makeProfile('profile-2', { disabled: true })], {
        current: VIRTUAL_ID,
      });
      useProfileStore.setState({ virtualProfiles: [group(['profile-1', 'profile-2'])] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.profiles).toEqual([profiles[0]]);
    });

    it('filters a member id no profile answers to (hand-edited storage)', () => {
      const profiles = seedProfiles(['profile-1'], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [group(['profile-1', 'ghost'])] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.profiles).toEqual([profiles[0]]);
    });

    it('collapses to null when every member is gone or disabled', () => {
      seedProfiles(['profile-1', makeProfile('profile-2', { disabled: true })], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [group(['profile-2'])] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current).toBeNull();
    });

    it('collapses to null for a virtual id with no group behind it', () => {
      seedProfiles(['profile-1'], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current).toBeNull();
    });

    it('keeps member order stable with the profile list, not the member list', () => {
      const profiles = seedProfiles(['profile-1', 'profile-2'], { current: VIRTUAL_ID });
      useProfileStore.setState({ virtualProfiles: [group(['profile-2', 'profile-1'])] });

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.profiles).toEqual(profiles);
    });
  });
});
