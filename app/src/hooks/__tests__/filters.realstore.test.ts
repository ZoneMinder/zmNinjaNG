/**
 * Events / Timeline filter persistence against the REAL stores (refs #337)
 *
 * The isolated hook tests mock both the profile store and the settings store,
 * so they prove the hooks ASK for the right bucket but not that the real
 * settings store hands the same bucket back. This test drives the whole chain:
 * the real profile store's currentProfileId (the ALL sentinel), the real
 * settings store's getProfileSettings/updateProfileSettings, and the real
 * useCurrentProfile subscription that resolves the bucket for the restore
 * path.
 *
 * It also covers the store-subscription class the testing playbook calls out:
 * both hooks gained a `useProfileStore((s) => s.currentProfileId)`
 * subscription, and a selector that loops shows up here as "Maximum update
 * depth exceeded", never in a test whose store is a mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventFilters } from '../useEventFilters';
import { useTimelineFilters } from '../useTimelineFilters';
import { useSettingsStore } from '../../stores/settings';
import { useProfileStore } from '../../stores/profile';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';
import type { Profile } from '../../api/types';

const mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, vi.fn()],
  useLocation: () => ({ state: null, pathname: '/events', search: '', hash: '', key: 'default' }),
}));

// stores/profile.ts (real, for its currentProfileId) pulls in sessions, auth
// and the bootstrap chain. Mock only those leaves, same set as the other
// real-store tests, so the store loads without network or secure storage.
vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));

vi.mock('../../api/time', () => ({
  getServerTimeZone: vi.fn(),
}));

vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(undefined),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/eventPoller', () => ({
  stopEventPoller: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    time: vi.fn(),
    profile: vi.fn(),
    profileService: vi.fn(),
    auth: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

function makeProfile(id: string): Profile {
  return {
    id: asProfileId(id),
    name: id,
    username: 'admin',
    password: 'secret',
    portalUrl: `http://${id}.local`,
    apiUrl: `http://${id}.local/api`,
    cgiUrl: `http://${id}.local/cgi-bin`,
    isDefault: false,
    createdAt: 0,
  };
}

const profileA = makeProfile('profile-a');
const profileB = makeProfile('profile-b');

describe('filter persistence against the real stores', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
    useProfileStore.setState({ profiles: [profileA, profileB], currentProfileId: ALL_PROFILES_ID });
  });

  it('round-trips an All-mode Events filter through the real settings store', () => {
    const first = renderHook(() => useEventFilters());
    act(() => {
      first.result.current.setSelectedMonitorIds([`${profileA.id}:3`]);
      first.result.current.setFavoritesOnly(true);
    });
    first.unmount();

    // The composite token survives the store round-trip whole, so profile-b's
    // query never inherits profile-a's monitor 3.
    expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).eventsPageFilters).toMatchObject({
      monitorIds: [`${profileA.id}:3`],
      favoritesOnly: true,
    });

    const second = renderHook(() => useEventFilters());
    expect(second.result.current.selectedMonitorIds).toEqual([`${profileA.id}:3`]);
    expect(second.result.current.favoritesOnly).toBe(true);

    // Switching to a single profile reads that profile's own bucket, which
    // the All-mode write never touched.
    second.unmount();
    act(() => {
      useProfileStore.setState({ currentProfileId: profileA.id });
    });
    const inSingleMode = renderHook(() => useEventFilters());
    expect(inSingleMode.result.current.selectedMonitorIds).toEqual([]);
    expect(inSingleMode.result.current.favoritesOnly).toBe(false);
  });

  it('round-trips an All-mode Timeline filter through the real settings store', () => {
    const first = renderHook(() => useTimelineFilters());
    act(() => {
      first.result.current.setCauseFilter('Motion');
    });
    first.unmount();

    expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).timelinePageFilters.causeFilter).toBe('Motion');

    const second = renderHook(() => useTimelineFilters());
    expect(second.result.current.causeFilter).toBe('Motion');
    expect(useSettingsStore.getState().getProfileSettings(profileA.id).timelinePageFilters.causeFilter).toBe('');
  });
});
