/**
 * useNotificationAutoConnect real-store integration test (refs #337 C1)
 *
 * Regression test for the profile-switch teardown bug found in review: the
 * isolated hook test drove the "disconnect on switch" path by hand-feeding
 * `isConnected: true` with a param combination the real caller
 * (NotificationHandler) can never produce - `isConnected` is scoped to the
 * NEW currentProfile after a switch, so it can never be true for the OLD
 * one. This test wires the hook exactly the way NotificationHandler does
 * (selectors over the REAL store) and drives it through actual
 * connect()/disconnect(), so the fix is proven against real state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCallback } from 'react';
import { useNotificationAutoConnect } from '../useNotificationAutoConnect';
import { useNotificationStore } from '../../stores/notifications';
import { useProfileStore } from '../../stores/profile';
import { asProfileId } from '../../api/types';
import type { Profile } from '../../api/types';
import type { ConnectionState } from '../../types/notifications';

const mockService = {
  connect: vi.fn().mockResolvedValue(undefined),
  onStateChange: vi.fn((cb: (state: ConnectionState) => void) => {
    mockService._stateCbs.push(cb);
    return vi.fn();
  }),
  onEvent: vi.fn(() => vi.fn()),
  setMonitorFilter: vi.fn().mockResolvedValue(undefined),
  updateBadgeCount: vi.fn().mockResolvedValue(undefined),
  registerPushToken: vi.fn().mockResolvedValue(undefined),
  deregisterPushToken: vi.fn().mockResolvedValue(undefined),
  _stateCbs: [] as Array<(state: ConnectionState) => void>,
};

vi.mock('../../services/notifications', () => ({
  getNotificationService: vi.fn(() => mockService),
  resetNotificationService: vi.fn(),
}));

vi.mock('../../services/eventPoller', () => ({
  stopEventPoller: vi.fn(),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      getProfileSettings: vi.fn(() => ({ bandwidthMode: 'normal' })),
    })),
  },
}));

vi.mock('../../api/notifications', () => ({
  updateNotification: vi.fn().mockResolvedValue({}),
}));

// stores/profile.ts (real, imported for its currentProfileId - refs #337
// I4) pulls in services/sessions and stores/auth, which pull in these leaf
// modules. Mock only the leaves (same set as stores/__tests__/profile.test.ts)
// so the real profile/auth/sessions modules load without hitting network or
// secure storage.
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

vi.mock('../../services/pushNotifications', () => ({
  setPushServiceStoreGates: vi.fn(),
  getPushService: vi.fn(() => ({
    isReady: vi.fn(() => false),
    registerTokenWithServer: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../lib/platform', () => ({
  Platform: { isDesktopOrWeb: true, isNative: false },
}));

vi.mock('../../lib/logger', () => ({
  log: {
    notifications: vi.fn(),
    notificationHandler: vi.fn(),
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
    createdAt: Date.now(),
  };
}

const profileA = makeProfile('profile-a');
const profileB = makeProfile('profile-b');

/**
 * Mirrors exactly how NotificationHandler wires the hook to the real store:
 * `isConnected` scoped to the NEW currentProfile, `isPreviousProfileConnected`
 * derived from the store's own anchor (state.currentProfileId), disconnect()
 * reading that anchor fresh at call time.
 */
function useWrapper(currentProfile: Profile | null) {
  const connections = useNotificationStore((s) => s.connections);
  const storeCurrentProfileId = useNotificationStore((s) => s.currentProfileId);
  const connect = useNotificationStore((s) => s.connect);

  const isConnected = currentProfile ? connections[currentProfile.id] === 'connected' : false;
  const isPreviousProfileConnected = storeCurrentProfileId
    ? connections[storeCurrentProfileId] === 'connected'
    : false;
  const connectionState = currentProfile ? (connections[currentProfile.id] ?? 'disconnected') : 'disconnected';

  const disconnect = useCallback(() => {
    const prevId = useNotificationStore.getState().currentProfileId;
    if (prevId) useNotificationStore.getState().disconnect(prevId);
  }, []);
  const reconnect = useCallback((force?: boolean) => {
    if (currentProfile) useNotificationStore.getState().reconnect(currentProfile.id, force);
  }, [currentProfile]);
  const getDecryptedPassword = useCallback(async () => 'secret', []);

  useNotificationAutoConnect({
    currentProfile,
    settings: currentProfile
      ? useNotificationStore.getState().getProfileSettings(currentProfile.id)
      : null,
    isConnected,
    isPreviousProfileConnected,
    connectionState,
    currentProfileId: storeCurrentProfileId,
    connect,
    disconnect,
    reconnect,
    getDecryptedPassword,
  });
}

describe('useNotificationAutoConnect + real store: profile switch teardown (refs #337 C1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockService._stateCbs = [];
    useNotificationStore.setState({
      profileSettings: {},
      connections: {},
      currentProfileId: null,
      _cleanupFunctions: {},
    });
    useNotificationStore.getState().updateProfileSettings(profileA.id, { enabled: true, host: 'a.local' });
    useNotificationStore.getState().updateProfileSettings(profileB.id, { enabled: true, host: 'b.local' });
  });

  afterEach(() => {
    useProfileStore.setState({ currentProfileId: null });
  });

  it('disconnects profile A and clears connections[A] when switching to profile B', async () => {
    // Single mode: the app's real current profile is A - this is what makes
    // connect() anchor `currentProfileId` to A (refs #337 I4), which is what
    // isPreviousProfileConnected reads.
    useProfileStore.setState({ currentProfileId: profileA.id });

    const { rerender } = renderHook(({ profile }) => useWrapper(profile), {
      initialProps: { profile: profileA as Profile | null },
    });

    // Let auto-connect fire for A and mark it connected.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });
    expect(mockService.connect).toHaveBeenCalledTimes(1);
    act(() => {
      mockService._stateCbs[0]('connected');
    });
    expect(useNotificationStore.getState().connections[profileA.id]).toBe('connected');
    expect(useNotificationStore.getState().currentProfileId).toBe(profileA.id);

    // Switch to B: mirrors the real app, where the profile store's
    // currentProfileId changes together with the `currentProfile` prop
    // NotificationHandler passes down.
    act(() => {
      useProfileStore.setState({ currentProfileId: profileB.id });
    });
    rerender({ profile: profileB });

    expect(useNotificationStore.getState().connections[profileA.id]).toBe('disconnected');
  });

  it('does not disconnect A when switching away while A was never connected', async () => {
    useProfileStore.setState({ currentProfileId: profileA.id });

    const { rerender } = renderHook(({ profile }) => useWrapper(profile), {
      initialProps: { profile: profileA as Profile | null },
    });

    // A's auto-connect is still in flight (never marked 'connected').
    act(() => {
      useProfileStore.setState({ currentProfileId: profileB.id });
    });
    rerender({ profile: profileB });

    // Nothing to disconnect - connections[A] was never set, so it stays
    // absent (not spuriously created as 'disconnected').
    expect(useNotificationStore.getState().connections[profileA.id]).toBeUndefined();
  });
});
