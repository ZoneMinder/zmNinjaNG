/**
 * useNativeLlmSupported Hook (refs #270)
 *
 * Probes the native `NativeLlm` plugin's `isSupported()` once on mount and
 * caches the result as render state, mirroring `useWebGpuAvailable`'s
 * undefined-while-probing / boolean-once-resolved shape so `AssistantSection`
 * gates the native backend option the same way it gates on-device WebGPU.
 * Resolves straight to `false` off iOS: the bridge is an iOS build artifact now
 * (see the platform check below), and the dynamic import stays behind that check
 * so no native bridge code reaches the web or Android bundle (Native contract).
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
  /** The plugin's stated reason when unsupported ('memory' or 'os'). Absent
   *  when the probe rejected or the platform has no plugin at all, so the UI
   *  can distinguish "this device can't run it" from "no native backend here". */
  reason?: 'platform' | 'memory' | 'os';
  /** The iOS version the engine needs, sent with reason 'os'. Native owns the
   *  number - it is llama.cpp's build floor, not ours - so the note quotes what
   *  the plugin reports rather than a copy that can drift. */
  minimumOs?: string;
}

export function useNativeLlmSupported(): NativeLlmSupport {
  const [support, setSupport] = useState<NativeLlmSupport>({ supported: undefined });

  useEffect(() => {
    if (isAssistantTestMode() && window.__nativeLlmMockSupported !== undefined) {
      setSupport({ supported: window.__nativeLlmMockSupported });
      return;
    }

    // iOS only. The llama.cpp bridge was removed from the Android build (issue #270):
    // with no GPU path there it decoded at ~6.6 tok/s against Gemini Nano's ~1.5s
    // turns, and it cost 76MB of native libraries plus a 2.5GB model download to do
    // it. Android's on-device backend is Gemini Nano; iOS keeps llama.cpp on Metal.
    if (!Platform.isIOS) {
      setSupport({ supported: false });
      return;
    }

    let cancelled = false;
    import('../plugins/native-llm')
      .then(({ NativeLlm }) => NativeLlm.isSupported())
      .then((result) => {
        if (!cancelled) {
          setSupport({ supported: result.supported, reason: result.reason, minimumOs: result.minimumOs });
        }
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
