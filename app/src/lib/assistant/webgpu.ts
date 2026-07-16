/**
 * WebGPU capability probe (refs #246)
 *
 * Presence of `navigator.gpu` alone does not mean the device has a usable
 * adapter (e.g. software/blocklisted GPUs resolve `requestAdapter()` to
 * `null`), so this actually requests one. The project has no
 * `@webgpu/types` dependency, hence the local minimal type and the same
 * `as` cast AssistantSection already used for the Phase 1 stub.
 */

interface MinimalGpu {
  requestAdapter: () => Promise<unknown>;
}

type NavigatorWithGpu = Navigator & { gpu?: MinimalGpu };

let cachedProbe: Promise<boolean> | undefined;

async function probeWebGpu(): Promise<boolean> {
  const gpu = typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithGpu).gpu;
  if (!gpu) return false;

  try {
    const adapter = await gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

/**
 * Resolves whether this device can actually run WebGPU inference, not just
 * whether the API exists. Memoizes the in-flight promise (not just the
 * resolved value) so concurrent callers share one `requestAdapter()` probe
 * and later callers never re-probe.
 */
export function hasWebGpu(): Promise<boolean> {
  if (!cachedProbe) {
    cachedProbe = probeWebGpu();
  }
  return cachedProbe;
}
