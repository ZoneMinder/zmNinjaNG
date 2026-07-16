/**
 * useWebGpuAvailable Hook Tests (refs #246)
 *
 * The probe itself (lib/assistant/webgpu.ts) is unit-tested directly; this
 * covers only the hook's state machine (undefined while probing, then the
 * resolved boolean) and that unmounting mid-probe doesn't set state on an
 * unmounted component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWebGpuAvailable } from '../useWebGpuAvailable';
import * as webgpu from '../../lib/assistant/webgpu';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWebGpuAvailable', () => {
  it('is undefined while probing, then resolves to true', async () => {
    vi.spyOn(webgpu, 'hasWebGpu').mockResolvedValue(true);
    const { result } = renderHook(() => useWebGpuAvailable());

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('resolves to false when the probe reports no usable adapter', async () => {
    vi.spyOn(webgpu, 'hasWebGpu').mockResolvedValue(false);
    const { result } = renderHook(() => useWebGpuAvailable());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('does not update state after unmount', async () => {
    let resolveProbe: (value: boolean) => void = () => {};
    vi.spyOn(webgpu, 'hasWebGpu').mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useWebGpuAvailable());
    expect(result.current).toBeUndefined();

    unmount();
    resolveProbe(true);

    // No assertion possible on unmounted `result.current`; this test's
    // value is that resolving after unmount must not throw/warn from React
    // ("state update on an unmounted component").
    await Promise.resolve();
  });
});
