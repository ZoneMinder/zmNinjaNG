/**
 * useNativeLlmSupported Hook (refs #270)
 *
 * Probes the native `NativeLlm` plugin's `isSupported()` once on mount and
 * caches the result as render state, mirroring `useWebGpuAvailable`'s
 * undefined-while-probing / boolean-once-resolved shape so `AssistantSection`
 * gates the native backend option the same way it gates on-device WebGPU.
 * Resolves straight to `false` off a native platform, where the plugin does
 * not exist at all (dynamic import behind `Platform.isNative`, rule 13).
 */

import { useEffect, useState } from 'react';
import { Platform } from '../lib/platform';

export function useNativeLlmSupported(): boolean | undefined {
  const [supported, setSupported] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!Platform.isNative) {
      setSupported(false);
      return;
    }

    let cancelled = false;
    import('../plugins/native-llm')
      .then(({ NativeLlm }) => NativeLlm.isSupported())
      .then((result) => {
        if (!cancelled) setSupported(result.supported);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return supported;
}
