/**
 * useNotificationDelivered Hook Tests
 *
 * Covers the appStateChange listener registration race: a listener that
 * resolves after effect cleanup must be removed immediately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useNotificationDelivered } from '../useNotificationDelivered';
import { resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

// Mock Platform (mutable so individual tests can flip isNative)
const mockPlatform = vi.hoisted(() => ({ isDesktopOrWeb: false, isNative: true }));
vi.mock('../../lib/platform', () => ({
  Platform: mockPlatform,
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    notificationHandler: vi.fn(),
  },
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

// Mock @capacitor/app (dynamically imported by the hook on native)
const mockAppAddListener = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/app', () => ({
  App: { addListener: mockAppAddListener },
}));

// Mock @capacitor-firebase/messaging (dynamically imported by the hook)
vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    getDeliveredNotifications: vi.fn().mockResolvedValue({ notifications: [] }),
    removeAllDeliveredNotifications: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock stores (getState usage inside the listener callback)
vi.mock('../../stores/notifications', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      currentProfileId: null,
      addEvent: vi.fn(),
      _updateBadge: vi.fn(),
    })),
  },
}));

describe('useNotificationDelivered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.isNative = true;
    mockAppAddListener.mockResolvedValue({ remove: vi.fn() });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('does not register the appStateChange listener on non-native platforms', async () => {
    mockPlatform.isNative = false;

    renderHook(() => useNotificationDelivered({ currentProfile: null }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAppAddListener).not.toHaveBeenCalled();
  });

  it('removes the appStateChange listener on unmount after registration resolves', async () => {
    const remove = vi.fn();
    mockAppAddListener.mockResolvedValueOnce({ remove });

    const { unmount } = renderHook(() => useNotificationDelivered({ currentProfile: null }));

    // Let the dynamic imports and addListener resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAppAddListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('removes the appStateChange listener when registration resolves after unmount', async () => {
    const remove = vi.fn();
    let resolveListener: (handle: { remove: () => void }) => void = () => {};
    mockAppAddListener.mockReturnValueOnce(
      new Promise((resolve) => { resolveListener = resolve; }),
    );

    const { unmount } = renderHook(() => useNotificationDelivered({ currentProfile: null }));

    // Let the dynamic imports resolve so addListener is invoked
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAppAddListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    // Unmount while addListener is still pending, then resolve it
    unmount();
    resolveListener({ remove });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
