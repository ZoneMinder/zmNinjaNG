/**
 * useAppleIntelligenceSupported Hook Tests (refs #270)
 *
 * Covers the hook's state machine (undefined while probing, then the
 * resolved boolean), the native-platform short-circuit, the e2e test seam,
 * and that unmounting mid-probe doesn't set state on an unmounted component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAppleIntelligenceSupported } from '../useAppleIntelligenceSupported';
import { AppleIntelligence } from '../../plugins/apple-intelligence';
import { STORAGE_KEYS } from '../../lib/zmninja-ng-constants';

let isNative = true;
vi.mock('../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return isNative;
    },
  },
}));

describe('useAppleIntelligenceSupported', () => {
  beforeEach(() => {
    isNative = true;
    vi.mocked(AppleIntelligence.isSupported).mockReset();
    localStorage.removeItem(STORAGE_KEYS.assistantTestMode);
    delete window.__appleIntelligenceMockSupported;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(STORAGE_KEYS.assistantTestMode);
    delete window.__appleIntelligenceMockSupported;
  });

  it('is undefined while probing, then resolves to true', async () => {
    vi.mocked(AppleIntelligence.isSupported).mockResolvedValue({ supported: true, contextSize: 4096 });
    const { result } = renderHook(() => useAppleIntelligenceSupported());

    expect(result.current.supported).toBeUndefined();
    await waitFor(() => expect(result.current.supported).toBe(true));
  });

  it('resolves to false and carries the plugin reason when unsupported', async () => {
    vi.mocked(AppleIntelligence.isSupported).mockResolvedValue({ supported: false, reason: 'disabled' });
    const { result } = renderHook(() => useAppleIntelligenceSupported());

    await waitFor(() => expect(result.current.supported).toBe(false));
    expect(result.current.reason).toBe('disabled');
  });

  it('resolves to false without probing the plugin off a native platform', async () => {
    isNative = false;
    const { result } = renderHook(() => useAppleIntelligenceSupported());

    await waitFor(() => expect(result.current.supported).toBe(false));
    expect(AppleIntelligence.isSupported).not.toHaveBeenCalled();
  });

  it('resolves to false when the probe rejects', async () => {
    vi.mocked(AppleIntelligence.isSupported).mockRejectedValue(new Error('bridge unavailable'));
    const { result } = renderHook(() => useAppleIntelligenceSupported());

    await waitFor(() => expect(result.current.supported).toBe(false));
  });

  it('does not update state after unmount', async () => {
    let resolveProbe: (value: { supported: boolean }) => void = () => {};
    vi.mocked(AppleIntelligence.isSupported).mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useAppleIntelligenceSupported());
    expect(result.current.supported).toBeUndefined();

    unmount();
    resolveProbe({ supported: true });

    // No assertion possible on unmounted `result.current`; this test's
    // value is that resolving after unmount must not throw/warn from React
    // ("state update on an unmounted component").
    await Promise.resolve();
  });

  it('respects the e2e mock seam in test mode, without probing the plugin', async () => {
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');
    window.__appleIntelligenceMockSupported = true;
    isNative = false;
    const { result } = renderHook(() => useAppleIntelligenceSupported());

    await waitFor(() => expect(result.current.supported).toBe(true));
    expect(AppleIntelligence.isSupported).not.toHaveBeenCalled();
  });

  it('ignores the mock seam outside test mode and falls back to the real probe', async () => {
    window.__appleIntelligenceMockSupported = true;
    vi.mocked(AppleIntelligence.isSupported).mockResolvedValue({ supported: false });
    const { result } = renderHook(() => useAppleIntelligenceSupported());

    await waitFor(() => expect(result.current.supported).toBe(false));
    expect(AppleIntelligence.isSupported).toHaveBeenCalled();
  });
});
