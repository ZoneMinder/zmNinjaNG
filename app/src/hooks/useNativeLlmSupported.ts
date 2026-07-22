/**
 * useNativeLlmSupported Hook (refs #270)
 *
 * Probes the native `NativeLlm` plugin's `isSupported()` once on mount and
 * caches the result as render state, mirroring `useWebGpuAvailable`'s
 * undefined-while-probing / boolean-once-resolved shape so `AssistantSection`
 * gates the native backend option the same way it gates on-device WebGPU.
 * Resolves straight to `false` off a native platform, where the plugin does
 * not exist at all (dynamic import behind `Platform.isNative`, rule 13).
 *
 * Test seam: in test mode (`isAssistantTestMode()`), `window.__nativeLlmMockSupported`
 * (set by e2e steps) short-circuits the real Capacitor probe when defined,
 * because Chromium e2e has no native bridge to fake genuinely (`Platform.isNative`
 * is always false there, and `NativeLlm` has no `web` jsImplementation, so a
 * real `isSupported()` call always rejects). This is the only
 * production-visible test seam this hook adds; `isAssistantTestMode()` is
 * false in production builds, so the branch never runs there. Mirrors
 * `window.__assistantMockScript` in AskPanel.tsx.
 */

import { useEffect, useState } from 'react';
import { Platform } from '../lib/platform';
import { isAssistantTestMode } from '../lib/assistant/providers/provider';

declare global {
  interface Window {
    /** e2e-only: forces this hook's resolved value when `isAssistantTestMode()`
     *  is true, bypassing the real `Platform.isNative` + `NativeLlm.isSupported()`
     *  probe. Never set outside tests/steps. */
    __nativeLlmMockSupported?: boolean;
  }
}

export interface NativeLlmSupport {
  /** undefined while the probe is in flight. */
  supported: boolean | undefined;
  /** The plugin's stated reason when unsupported ('memory' today). Absent
   *  when the probe rejected or the platform has no plugin at all, so the UI
   *  can distinguish "this device can't run it" from "no native backend here". */
  reason?: 'platform' | 'memory';
}

export function useNativeLlmSupported(): NativeLlmSupport {
  const [support, setSupport] = useState<NativeLlmSupport>({ supported: undefined });

  useEffect(() => {
    if (isAssistantTestMode() && window.__nativeLlmMockSupported !== undefined) {
      setSupport({ supported: window.__nativeLlmMockSupported });
      return;
    }

    if (!Platform.isNative) {
      setSupport({ supported: false });
      return;
    }

    let cancelled = false;
    import('../plugins/native-llm')
      .then(({ NativeLlm }) => NativeLlm.isSupported())
      .then((result) => {
        if (!cancelled) setSupport({ supported: result.supported, reason: result.reason });
      })
      .catch(() => {
        if (!cancelled) setSupport({ supported: false });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}
