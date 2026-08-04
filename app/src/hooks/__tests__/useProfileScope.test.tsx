import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProfileScope } from '../useProfileScope';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { ALL_PROFILES_ID } from '../../api/types';

// Mock the stores
vi.mock('../../stores/profile', () => ({
  useProfileStore: vi.fn(),
}));

vi.mock('../../stores/settings', () => {
  const DEFAULT_SETTINGS = {
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'system',
    snapshotRefreshInterval: 3,
    streamMaxFps: 10,
    streamScale: 50,
    montageByGroup: {},
    eventMontageByGroup: {},
    monitorDetailCycleSeconds: 0,
    defaultEventLimit: 300,
    eventsThumbnailFit: 'contain',
    disableLogRedaction: false,
    dashboardRefreshInterval: 30,
  };
  return {
    useSettingsStore: vi.fn(),
    DEFAULT_SETTINGS,
    mergeProfileSettings: (raw: Record<string, unknown> | undefined) => ({ ...DEFAULT_SETTINGS, ...raw }),
  };
});

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}));

const mockProfile = {
  id: 'profile-1',
  name: 'Home Server',
  apiUrl: 'http://localhost/api',
  portalUrl: 'http://localhost',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: true,
  createdAt: Date.now(),
};

const mockProfile2 = {
  id: 'profile-2',
  name: 'Work Server',
  apiUrl: 'http://work/api',
  portalUrl: 'http://work',
  cgiUrl: 'http://work/cgi-bin',
  isDefault: false,
  createdAt: Date.now(),
};

function mockStores(profileState: Record<string, unknown>, settingsState: Record<string, unknown>) {
  vi.mocked(useProfileStore).mockImplementation((selector) => selector(profileState as never));
  vi.mocked(useSettingsStore).mockImplementation((selector) => selector(settingsState as never));
}

describe('useProfileScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns single mode with the profile and its own settings', () => {
    mockStores(
      { profiles: [mockProfile, mockProfile2], currentProfileId: 'profile-1' },
      { profileSettings: { 'profile-1': { streamMaxFps: 15 } } }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('single');
    expect(result.current?.profile).toEqual(mockProfile);
    expect(result.current?.profiles).toEqual([mockProfile]);
    expect(result.current?.settings.streamMaxFps).toBe(15);
  });

  it('returns all mode with every profile and the ALL settings bucket', () => {
    mockStores(
      { profiles: [mockProfile, mockProfile2], currentProfileId: ALL_PROFILES_ID },
      { profileSettings: { [ALL_PROFILES_ID]: { streamMaxFps: 42 } } }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profile).toBeNull();
    expect(result.current?.profiles).toEqual([mockProfile, mockProfile2]);
    // Value round-trip: a setting written to the ALL bucket comes back.
    expect(result.current?.settings.streamMaxFps).toBe(42);
  });

  it('returns null when no profiles are selected', () => {
    mockStores({ profiles: [], currentProfileId: null }, { profileSettings: {} });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  it('returns null when currentProfileId matches no profile', () => {
    mockStores(
      { profiles: [mockProfile], currentProfileId: 'non-existent-profile' },
      { profileSettings: {} }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  it('returns null when the ALL_PROFILES_ID sentinel is selected with no profiles left', () => {
    // Deleting profiles one-by-one while in All mode leaves the sentinel
    // selected with an empty profiles list (deleteProfile only resets
    // currentProfileId when it equals the deleted id, never for the
    // sentinel). null must mean "route to setup" here too.
    mockStores({ profiles: [], currentProfileId: ALL_PROFILES_ID }, { profileSettings: {} });

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  it('is not in all mode for a single-profile selection', () => {
    mockStores(
      { profiles: [mockProfile], currentProfileId: 'profile-1' },
      { profileSettings: {} }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('single');
  });

  it('is in all mode for the ALL_PROFILES_ID sentinel', () => {
    mockStores(
      { profiles: [mockProfile], currentProfileId: ALL_PROFILES_ID },
      { profileSettings: {} }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
  });

  // refs #337: profile disable toggle
  it('excludes a disabled profile from the All mode profiles list', () => {
    const disabledProfile = { ...mockProfile2, disabled: true };
    mockStores(
      { profiles: [mockProfile, disabledProfile], currentProfileId: ALL_PROFILES_ID },
      { profileSettings: {} }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profiles).toEqual([mockProfile]);
  });

  it('is still All mode with a single enabled profile left after filtering (existing mode semantics)', () => {
    const disabledProfile = { ...mockProfile2, disabled: true };
    mockStores(
      { profiles: [mockProfile, disabledProfile], currentProfileId: ALL_PROFILES_ID },
      { profileSettings: {} }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profiles).toHaveLength(1);
  });

  it('treats a disabled persisted current profile as null scope', () => {
    const disabledProfile = { ...mockProfile, disabled: true };
    mockStores(
      { profiles: [disabledProfile, mockProfile2], currentProfileId: 'profile-1' },
      { profileSettings: {} }
    );

    const { result } = renderHook(() => useProfileScope());

    expect(result.current).toBeNull();
  });

  // refs #337: virtual profiles - a named group aggregates like All Servers
  // over its own members.
  describe('virtual profiles', () => {
    const VIRTUAL_ID = '__virtual_g1';
    const group = (memberProfileIds: string[]) => ({
      id: VIRTUAL_ID,
      name: 'Upstairs',
      memberProfileIds,
    });

    it('aggregates over the group members only', () => {
      mockStores(
        {
          profiles: [mockProfile, mockProfile2],
          virtualProfiles: [group(['profile-2'])],
          currentProfileId: VIRTUAL_ID,
        },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.mode).toBe('all');
      expect(result.current?.profiles).toEqual([mockProfile2]);
      expect(result.current?.profile).toBeNull();
    });

    it('names the aggregate so consumers can label it', () => {
      mockStores(
        {
          profiles: [mockProfile, mockProfile2],
          virtualProfiles: [group(['profile-1', 'profile-2'])],
          currentProfileId: VIRTUAL_ID,
        },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.mode === 'all' && result.current.aggregateId).toBe(VIRTUAL_ID);
      expect(result.current?.mode === 'all' && result.current.aggregateName).toBe('Upstairs');
    });

    it('leaves All Servers unnamed, so consumers use the localized label', () => {
      mockStores(
        { profiles: [mockProfile], currentProfileId: ALL_PROFILES_ID },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.mode === 'all' && result.current.aggregateId).toBe(ALL_PROFILES_ID);
      expect(result.current?.mode === 'all' && result.current.aggregateName).toBeNull();
    });

    it('reads the group\'s own settings bucket, not the All bucket', () => {
      mockStores(
        {
          profiles: [mockProfile, mockProfile2],
          virtualProfiles: [group(['profile-1'])],
          currentProfileId: VIRTUAL_ID,
        },
        {
          profileSettings: {
            [VIRTUAL_ID]: { streamMaxFps: 11 },
            [ALL_PROFILES_ID]: { streamMaxFps: 42 },
          },
        }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.settings.streamMaxFps).toBe(11);
    });

    it('filters a disabled member out of the group', () => {
      mockStores(
        {
          profiles: [mockProfile, { ...mockProfile2, disabled: true }],
          virtualProfiles: [group(['profile-1', 'profile-2'])],
          currentProfileId: VIRTUAL_ID,
        },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.profiles).toEqual([mockProfile]);
    });

    it('filters a member id no profile answers to (hand-edited storage)', () => {
      mockStores(
        {
          profiles: [mockProfile],
          virtualProfiles: [group(['profile-1', 'ghost'])],
          currentProfileId: VIRTUAL_ID,
        },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.profiles).toEqual([mockProfile]);
    });

    it('collapses to null when every member is gone or disabled', () => {
      mockStores(
        {
          profiles: [mockProfile, { ...mockProfile2, disabled: true }],
          virtualProfiles: [group(['profile-2'])],
          currentProfileId: VIRTUAL_ID,
        },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current).toBeNull();
    });

    it('collapses to null for a virtual id with no group behind it', () => {
      mockStores(
        { profiles: [mockProfile], virtualProfiles: [], currentProfileId: VIRTUAL_ID },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current).toBeNull();
    });

    it('keeps member order stable with the profile list, not the member list', () => {
      mockStores(
        {
          profiles: [mockProfile, mockProfile2],
          virtualProfiles: [group(['profile-2', 'profile-1'])],
          currentProfileId: VIRTUAL_ID,
        },
        { profileSettings: {} }
      );

      const { result } = renderHook(() => useProfileScope());

      expect(result.current?.profiles).toEqual([mockProfile, mockProfile2]);
    });
  });
});
