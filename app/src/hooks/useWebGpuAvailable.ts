/**
 * useWebGpuAvailable Hook (refs #246)
 *
 * Runs the async `hasWebGpu()` probe (lib/assistant/webgpu.ts) on mount and
 * exposes it as render state, since the probe itself must stay React-free
 * (rule 33: lib/ modules never import React). Returns `undefined` while the
 * probe is in flight so callers (AssistantSection's toggle) can tell
 * "checking" apart from "checked and unavailable".
 */

import { useEffect, useState } from 'react';
import { hasWebGpu } from '../lib/assistant/webgpu';

export function useWebGpuAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    hasWebGpu().then((result) => {
      if (!cancelled) setAvailable(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
