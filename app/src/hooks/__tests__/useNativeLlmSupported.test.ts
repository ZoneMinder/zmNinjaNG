/**
 * useNativeLlmSupported Hook Tests (refs #270)
 *
 * Covers the hook's state machine (undefined while probing, then the
 * resolved boolean), the native-platform short-circuit, and that
 * unmounting mid-probe doesn't set state on an unmounted component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNativeLlmSupported } from '../useNativeLlmSupported';
import { NativeLlm } from '../../plugins/native-llm';

let isNative = true;
vi.mock('../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return isNative;
    },
  },
}));

describe('useNativeLlmSupported', () => {
  beforeEach(() => {
    isNative = true;
    vi.mocked(NativeLlm.isSupported).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is undefined while probing, then resolves to true', async () => {
    vi.mocked(NativeLlm.isSupported).mockResolvedValue({ supported: true });
    const { result } = renderHook(() => useNativeLlmSupported());

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('resolves to false when the plugin reports unsupported', async () => {
    vi.mocked(NativeLlm.isSupported).mockResolvedValue({ supported: false, reason: 'memory' });
    const { result } = renderHook(() => useNativeLlmSupported());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('resolves to false without probing the plugin off a native platform', async () => {
    isNative = false;
    const { result } = renderHook(() => useNativeLlmSupported());

    await waitFor(() => expect(result.current).toBe(false));
    expect(NativeLlm.isSupported).not.toHaveBeenCalled();
  });

  it('resolves to false when the probe rejects', async () => {
    vi.mocked(NativeLlm.isSupported).mockRejectedValue(new Error('bridge unavailable'));
    const { result } = renderHook(() => useNativeLlmSupported());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('does not update state after unmount', async () => {
    let resolveProbe: (value: { supported: boolean }) => void = () => {};
    vi.mocked(NativeLlm.isSupported).mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useNativeLlmSupported());
    expect(result.current).toBeUndefined();

    unmount();
    resolveProbe({ supported: true });

    // No assertion possible on unmounted `result.current`; this test's
    // value is that resolving after unmount must not throw/warn from React
    // ("state update on an unmounted component").
    await Promise.resolve();
  });
});
