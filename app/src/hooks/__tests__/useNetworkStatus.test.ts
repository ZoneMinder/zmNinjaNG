/**
 * useNetworkStatus Hook Tests
 *
 * Tests the web (navigator.onLine + online/offline events) and native
 * (Capacitor Network plugin) code paths, and that they don't interfere
 * with each other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from '../useNetworkStatus';

// Mock Platform (mutable so individual tests can flip isNative)
const mockPlatform = vi.hoisted(() => ({ isNative: false }));
vi.mock('../../lib/platform', () => ({
  Platform: mockPlatform,
}));

// @capacitor/network is already mocked globally in tests/setup.ts. Reuse that
// mock (rather than re-declaring vi.mock here) and configure it per test via
// vi.mocked(), matching the pattern in useNotificationAutoConnect.test.ts.
const { Network: mockNetwork } = await import('@capacitor/network');

const flushAsync = () => act(async () => {});

describe('useNetworkStatus', () => {
  beforeEach(() => {
    mockPlatform.isNative = false;
    vi.mocked(mockNetwork.getStatus).mockReset().mockResolvedValue({ connected: true, connectionType: 'wifi' });
    vi.mocked(mockNetwork.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reflects navigator.onLine on web at mount', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it('flips to offline and back on browser online/offline events', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOnline).toBe(true);
  });

  it('does not touch the Capacitor Network plugin on web', async () => {
    renderHook(() => useNetworkStatus());
    await flushAsync();

    expect(mockNetwork.getStatus).not.toHaveBeenCalled();
    expect(mockNetwork.addListener).not.toHaveBeenCalled();
  });

  it('reads the initial status from the Network plugin on native', async () => {
    mockPlatform.isNative = true;
    vi.mocked(mockNetwork.getStatus).mockResolvedValue({ connected: false, connectionType: 'none' });

    const { result } = renderHook(() => useNetworkStatus());
    await flushAsync();

    expect(mockNetwork.getStatus).toHaveBeenCalledTimes(1);
    expect(result.current.isOnline).toBe(false);
  });

  it('subscribes to networkStatusChange on native and updates on events', async () => {
    mockPlatform.isNative = true;
    let capturedHandler: ((status: { connected: boolean }) => void) | undefined;
    vi.mocked(mockNetwork.addListener).mockImplementation(async (_event, handler) => {
      capturedHandler = handler as (status: { connected: boolean }) => void;
      return { remove: vi.fn() };
    });

    const { result } = renderHook(() => useNetworkStatus());
    await flushAsync();
    await flushAsync();

    expect(mockNetwork.addListener).toHaveBeenCalledWith('networkStatusChange', expect.any(Function));

    act(() => {
      capturedHandler?.({ connected: false });
    });
    expect(result.current.isOnline).toBe(false);

    act(() => {
      capturedHandler?.({ connected: true });
    });
    expect(result.current.isOnline).toBe(true);
  });
});
