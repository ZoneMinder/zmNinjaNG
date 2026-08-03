/**
 * useNotificationAutoConnect Hook Tests
 *
 * Tests auto-connect trigger conditions, profile-switch disconnect,
 * mode-based branching, and network/visibility reconnect behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PluginListenerHandle } from '@capacitor/core';
import { useNotificationAutoConnect } from '../useNotificationAutoConnect';
import { asProfileId } from '../../api/types';

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    notifications: vi.fn(),
    notificationHandler: vi.fn(),
  },
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

// Mock Platform (mutable so individual tests can flip isNative)
const mockPlatform = vi.hoisted(() => ({ isDesktopOrWeb: true, isNative: false }));
vi.mock('../../lib/platform', () => ({
  Platform: mockPlatform,
}));

// Mock @capacitor/app (dynamically imported by the hook on native)
const mockAppAddListener = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/app', () => ({
  App: { addListener: mockAppAddListener },
}));

// Mock notification store (getState + poller wiring usage inside hook)
const mockNotificationStoreState = { connections: {} as Record<string, string> };
const mockStartEventPoller = vi.fn().mockResolvedValue(undefined);

vi.mock('../../stores/notifications', () => ({
  useNotificationStore: {
    getState: vi.fn(() => mockNotificationStoreState),
  },
  startEventPoller: (profileId: string) => mockStartEventPoller(profileId),
}));

// Mock event poller
const mockStopEventPoller = vi.fn();

vi.mock('../../services/eventPoller', () => ({
  stopEventPoller: (profileId: string) => mockStopEventPoller(profileId),
}));

// Mock notification service
const mockCheckAlive = vi.fn().mockResolvedValue(true);

vi.mock('../../services/notifications', () => ({
  getNotificationService: vi.fn(() => ({
    checkAlive: mockCheckAlive,
  })),
}));

// --- Helpers ---

type Settings = {
  enabled?: boolean;
  notificationMode?: string;
  host?: string;
};

const defaultProfile = {
  id: asProfileId('profile-1'),
  username: 'admin' as string | undefined,
  password: 'secret' as string | undefined,
  portalUrl: 'http://zm.local',
  name: 'Test Profile',
  apiUrl: 'http://zm.local/api',
  cgiUrl: 'http://zm.local/cgi-bin',
  isDefault: true,
  createdAt: Date.now(),
};

const defaultSettings: Settings = {
  enabled: true,
  notificationMode: 'es',
  host: 'ws://zmeventserver:9000',
};

function makeParams(overrides: Partial<{
  currentProfile: typeof defaultProfile | null;
  settings: Settings | null;
  isConnected: boolean;
  isPreviousProfileConnected: boolean;
  connectionState: string;
  currentProfileId: string | null;
}> & Record<string, unknown> = {}) {
  const connect = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn();
  const reconnect = vi.fn();
  const getDecryptedPassword = vi.fn().mockResolvedValue('secret');

  return {
    currentProfile: defaultProfile,
    settings: defaultSettings,
    isConnected: false,
    isPreviousProfileConnected: false,
    connectionState: 'disconnected',
    currentProfileId: 'profile-1',
    connect,
    disconnect,
    reconnect,
    getDecryptedPassword,
    ...overrides,
  };
}

describe('useNotificationAutoConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockNotificationStoreState.connections = {};
    mockPlatform.isDesktopOrWeb = true;
    mockPlatform.isNative = false;
    mockAppAddListener.mockResolvedValue({ remove: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('disabled notifications', () => {
    it('does not attempt connect when settings.enabled is false', async () => {
      const params = makeParams({ settings: { ...defaultSettings, enabled: false } });
      renderHook(() => useNotificationAutoConnect(params));

      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not start event poller when settings.enabled is false', () => {
      const params = makeParams({
        settings: { ...defaultSettings, enabled: false, notificationMode: 'direct' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      expect(mockStartEventPoller).not.toHaveBeenCalled();
    });

    it('does not attempt connect when settings is null', () => {
      const params = makeParams({ settings: null });
      renderHook(() => useNotificationAutoConnect(params));

      vi.runAllTimers();

      expect(params.connect).not.toHaveBeenCalled();
    });
  });

  describe('ES mode auto-connect', () => {
    it('calls connect with profile credentials after delay', async () => {
      const params = makeParams();
      renderHook(() => useNotificationAutoConnect(params));

      // Advance the 500ms delay and flush microtasks
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Allow async getDecryptedPassword + connect to resolve
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(params.connect).toHaveBeenCalledWith(
        'profile-1',
        'admin',
        'secret',
        'http://zm.local',
      );
    });

    it('does not connect when already connected', async () => {
      const params = makeParams({ isConnected: true });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not connect when connectionState is not "disconnected"', async () => {
      const params = makeParams({ connectionState: 'connecting' });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not connect when host is missing', async () => {
      const params = makeParams({ settings: { ...defaultSettings, host: undefined } });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not connect when profile has no username', async () => {
      const params = makeParams({
        currentProfile: { ...defaultProfile, username: undefined },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not connect when currentProfile is null', async () => {
      const params = makeParams({ currentProfile: null });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('skips connect when store state changes to non-disconnected before async completes', async () => {
      const params = makeParams();
      // Simulate store having changed state by the time decrypt resolves
      params.getDecryptedPassword = vi.fn().mockImplementation(async () => {
        mockNotificationStoreState.connections = { 'profile-1': 'connecting' };
        return 'secret';
      });

      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not connect when password cannot be decrypted', async () => {
      const params = makeParams();
      params.getDecryptedPassword = vi.fn().mockResolvedValue(null);

      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('only attempts auto-connect once per mount', async () => {
      const params = makeParams();
      const { rerender } = renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).toHaveBeenCalledTimes(1);

      rerender();

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      // Still only once: hasAttemptedAutoConnect flag prevents repeated calls
      expect(params.connect).toHaveBeenCalledTimes(1);
    });

    // Regression (refs #337 I3): the 500ms delay timer was never cancelled,
    // so unmounting mid-window (or mid-getDecryptedPassword) could still
    // connect a socket nobody would ever disconnect.
    it('cancels the pending auto-connect timer on unmount before it fires', async () => {
      const params = makeParams();
      const { unmount } = renderHook(() => useNotificationAutoConnect(params));

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    it('does not connect if unmounted while decrypting the password', async () => {
      const params = makeParams();
      let resolvePassword: (value: string) => void = () => {};
      params.getDecryptedPassword = vi.fn().mockImplementation(
        () => new Promise<string>((resolve) => { resolvePassword = resolve; })
      );

      const { unmount } = renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      unmount();
      resolvePassword('secret');

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });

    // Regression (refs #337 round 2, critical): bootstrap routinely writes a
    // NEW profile object with the SAME id (e.g. after a token refresh).
    // Depending on the whole `currentProfile` object re-ran this effect on
    // that identity churn; combined with the I3 timer-cancel cleanup, the
    // re-run cancelled the pending timer, then hit the hasAttemptedAutoConnect
    // guard and returned without rescheduling - ES never connected for the
    // rest of the session.
    it('still connects after a mid-window rerender with a new profile object of the same id', async () => {
      const params = makeParams();
      const { rerender } = renderHook(
        (p: Parameters<typeof useNotificationAutoConnect>[0]) => useNotificationAutoConnect(p),
        { initialProps: params },
      );

      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      // Same id, same credentials, new object identity - simulates a
      // bootstrap/updateProfile write mid-window.
      rerender({ ...params, currentProfile: { ...defaultProfile } });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).toHaveBeenCalledWith('profile-1', 'admin', 'secret', 'http://zm.local');
    });

    it('reschedules instead of permanently stalling when a primitive dep changes mid-window', async () => {
      const params = makeParams();
      const { rerender } = renderHook(
        (p: Parameters<typeof useNotificationAutoConnect>[0]) => useNotificationAutoConnect(p),
        { initialProps: params },
      );

      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      // A genuine primitive change (host) interrupts the window - this MUST
      // still result in exactly one connect() once things settle, not zero.
      rerender({ ...params, settings: { ...defaultSettings, host: 'ws://new-host:9000' } });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('direct mode auto-connect (desktop/web)', () => {
    it('starts event poller for direct mode on desktop', () => {
      const params = makeParams({
        settings: { ...defaultSettings, notificationMode: 'direct' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      expect(mockStartEventPoller).toHaveBeenCalledWith('profile-1');
    });

    it('does not call connect() in direct mode', async () => {
      const params = makeParams({
        settings: { ...defaultSettings, notificationMode: 'direct' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(params.connect).not.toHaveBeenCalled();
    });
  });

  describe('profile switching', () => {
    it('disconnects when profile changes and the previous profile was connected', () => {
      const params = makeParams({
        isPreviousProfileConnected: true,
        currentProfileId: 'profile-OLD',
        currentProfile: { ...defaultProfile, id: asProfileId('profile-NEW') },
      });
      renderHook(() => useNotificationAutoConnect(params));

      expect(params.disconnect).toHaveBeenCalled();
    });

    // Regression (refs #337 C1): `isConnected` alone is scoped to the NEW
    // currentProfile after a switch and can never see whether the OLD
    // (anchor) profile is still connected - `isPreviousProfileConnected` is
    // the value that must gate this, independently of `isConnected`.
    it('does not disconnect when isConnected is true but the previous profile was not', () => {
      const params = makeParams({
        isConnected: true,
        isPreviousProfileConnected: false,
        currentProfileId: 'profile-OLD',
        currentProfile: { ...defaultProfile, id: asProfileId('profile-NEW') },
      });
      renderHook(() => useNotificationAutoConnect(params));

      expect(params.disconnect).not.toHaveBeenCalled();
    });

    it('does not disconnect when connected to the same profile', () => {
      const params = makeParams({
        isPreviousProfileConnected: true,
        currentProfileId: 'profile-1',
        currentProfile: defaultProfile,
      });
      renderHook(() => useNotificationAutoConnect(params));

      expect(params.disconnect).not.toHaveBeenCalled();
    });

    it('resets auto-connect flag when notification mode changes', async () => {
      const { result, rerender } = renderHook(
        (props: Parameters<typeof useNotificationAutoConnect>[0]) =>
          useNotificationAutoConnect(props),
        {
          initialProps: makeParams(),
        },
      );

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(result.current).toBeUndefined(); // hook returns void

      // Change notification mode: this resets hasAttemptedAutoConnect
      const newParams = makeParams({
        settings: { ...defaultSettings, notificationMode: 'direct' },
      });

      rerender(newParams);

      // Poller should now be started (new mode = direct)
      expect(mockStartEventPoller).toHaveBeenCalled();
    });
  });

  describe('event poller cleanup', () => {
    it('stops this profile\'s event poller on unmount', () => {
      const params = makeParams({
        settings: { ...defaultSettings, notificationMode: 'direct' },
      });

      const { unmount } = renderHook(() => useNotificationAutoConnect(params));

      unmount();

      expect(mockStopEventPoller).toHaveBeenCalledWith('profile-1');
    });

    it('does not call stopEventPoller when currentProfile is null', () => {
      const params = makeParams({ currentProfile: null });

      const { unmount } = renderHook(() => useNotificationAutoConnect(params));

      unmount();

      expect(mockStopEventPoller).not.toHaveBeenCalled();
    });
  });

  describe('network change reconnect', () => {
    it('calls reconnect when online event fires in ES mode', () => {
      const params = makeParams({ settings: { ...defaultSettings, enabled: true, notificationMode: 'es' } });
      renderHook(() => useNotificationAutoConnect(params));

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(params.reconnect).toHaveBeenCalled();
    });

    it('does not add online listener for direct mode', () => {
      const params = makeParams({
        settings: { ...defaultSettings, notificationMode: 'direct' },
      });
      const addEventSpy = vi.spyOn(window, 'addEventListener');

      renderHook(() => useNotificationAutoConnect(params));

      const onlineListeners = addEventSpy.mock.calls.filter(([event]) => event === 'online');
      expect(onlineListeners).toHaveLength(0);

      addEventSpy.mockRestore();
    });

    it('removes online listener on unmount', () => {
      const params = makeParams({ settings: { ...defaultSettings, enabled: true, notificationMode: 'es' } });
      const removeEventSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useNotificationAutoConnect(params));
      unmount();

      const removed = removeEventSpy.mock.calls.some(([event]) => event === 'online');
      expect(removed).toBe(true);

      removeEventSpy.mockRestore();
    });
  });

  describe('native listener registration races', () => {
    it('removes the network listener when registration resolves after unmount', async () => {
      mockPlatform.isNative = true;
      const remove = vi.fn().mockResolvedValue(undefined);
      let resolveListener: (handle: PluginListenerHandle) => void = () => {};
      const { Network } = await import('@capacitor/network');
      vi.mocked(Network.addListener).mockReturnValueOnce(
        new Promise<PluginListenerHandle>((resolve) => { resolveListener = resolve; }),
      );

      const params = makeParams();
      const { unmount } = renderHook(() => useNotificationAutoConnect(params));

      // Let the dynamic import resolve so addListener is invoked
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(Network.addListener).toHaveBeenCalled();

      // Unmount while addListener is still pending, then resolve it
      unmount();
      resolveListener({ remove });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('removes the app resume listener when registration resolves after unmount', async () => {
      mockPlatform.isNative = true;
      const remove = vi.fn();
      let resolveListener: (handle: { remove: () => void }) => void = () => {};
      mockAppAddListener.mockReturnValueOnce(
        new Promise((resolve) => { resolveListener = resolve; }),
      );

      const params = makeParams();
      const { unmount } = renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockAppAddListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

      unmount();
      resolveListener({ remove });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(remove).toHaveBeenCalledTimes(1);
    });
  });

  describe('visibility change reconnect (web)', () => {
    it('calls reconnect when tab becomes visible and WebSocket is not alive', async () => {
      mockCheckAlive.mockResolvedValue(false);

      const params = makeParams({
        isConnected: true,
        settings: { ...defaultSettings, enabled: true, notificationMode: 'es' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Allow checkAlive promise to resolve
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Forced: the socket still reads as connected, so an unforced reconnect
      // would be refused by the service (refs #274).
      expect(params.reconnect).toHaveBeenCalledWith(true);
    });

    it('does not call reconnect when WebSocket is alive on tab focus', async () => {
      mockCheckAlive.mockResolvedValue(true);

      const params = makeParams({
        isConnected: true,
        settings: { ...defaultSettings, enabled: true, notificationMode: 'es' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();
      });

      expect(params.reconnect).not.toHaveBeenCalled();
    });

    // A hidden tab has its timers frozen, so the scheduled backoff reconnect
    // may be minutes out or may never have run. Retry on focus (refs #274).
    it('reconnects without a liveness check when disconnected on tab focus', async () => {
      const params = makeParams({
        isConnected: false,
        settings: { ...defaultSettings, enabled: true, notificationMode: 'es' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();
      });

      expect(mockCheckAlive).not.toHaveBeenCalled();
      expect(params.reconnect).toHaveBeenCalledWith();
    });

    it('removes visibilitychange listener on unmount', () => {
      const params = makeParams({ settings: { ...defaultSettings, enabled: true, notificationMode: 'es' } });
      const removeEventSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = renderHook(() => useNotificationAutoConnect(params));
      unmount();

      const removed = removeEventSpy.mock.calls.some(([event]) => event === 'visibilitychange');
      expect(removed).toBe(true);

      removeEventSpy.mockRestore();
    });
  });

  describe('app resume reconnect (native)', () => {
    it('reconnects on app resume while disconnected, without a liveness check', async () => {
      mockPlatform.isNative = true;
      const params = makeParams({
        isConnected: false,
        settings: { ...defaultSettings, enabled: true, notificationMode: 'es' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const handler = mockAppAddListener.mock.calls.find(([event]) => event === 'appStateChange')?.[1];
      await act(async () => {
        await handler({ isActive: true });
      });

      expect(mockCheckAlive).not.toHaveBeenCalled();
      expect(params.reconnect).toHaveBeenCalledWith();
    });

    it('forces a reconnect on app resume when the socket does not answer', async () => {
      mockPlatform.isNative = true;
      mockCheckAlive.mockResolvedValue(false);
      const params = makeParams({
        isConnected: true,
        settings: { ...defaultSettings, enabled: true, notificationMode: 'es' },
      });
      renderHook(() => useNotificationAutoConnect(params));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const handler = mockAppAddListener.mock.calls.find(([event]) => event === 'appStateChange')?.[1];
      await act(async () => {
        await handler({ isActive: true });
      });

      expect(params.reconnect).toHaveBeenCalledWith(true);
    });
  });
});
