/**
 * hasWebGpu (refs #246)
 *
 * Presence of `navigator.gpu` alone does not mean a usable adapter exists,
 * so the probe calls `requestAdapter()` and checks the result is non-null.
 * The module memoizes the in-flight promise so repeated calls (settings
 * remounting the toggle, the `?` hook gate) never re-probe.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

type NavigatorWithGpu = Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };

function setGpu(gpu: NavigatorWithGpu['gpu'] | undefined) {
  Object.defineProperty(navigator, 'gpu', {
    value: gpu,
    configurable: true,
    writable: true,
  });
}

describe('hasWebGpu', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (navigator as NavigatorWithGpu).gpu;
  });

  it('returns false when navigator.gpu is absent', async () => {
    setGpu(undefined);
    const { hasWebGpu } = await import('../webgpu');
    await expect(hasWebGpu()).resolves.toBe(false);
  });

  it('returns true when requestAdapter resolves a non-null adapter', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
    const { hasWebGpu } = await import('../webgpu');
    await expect(hasWebGpu()).resolves.toBe(true);
  });

  it('returns false when requestAdapter resolves null', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue(null) });
    const { hasWebGpu } = await import('../webgpu');
    await expect(hasWebGpu()).resolves.toBe(false);
  });

  it('returns false when requestAdapter throws', async () => {
    setGpu({ requestAdapter: vi.fn().mockRejectedValue(new Error('no gpu')) });
    const { hasWebGpu } = await import('../webgpu');
    await expect(hasWebGpu()).resolves.toBe(false);
  });

  it('memoizes the result promise across repeated calls', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({});
    setGpu({ requestAdapter });
    const { hasWebGpu } = await import('../webgpu');
    await hasWebGpu();
    await hasWebGpu();
    await hasWebGpu();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});
