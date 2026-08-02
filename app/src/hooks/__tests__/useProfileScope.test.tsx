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
});
