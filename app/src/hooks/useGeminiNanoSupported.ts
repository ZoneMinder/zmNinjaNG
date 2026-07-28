/**
 * useGeminiNanoSupported Hook (refs #270)
 *
 * Probes the native `GeminiNano` plugin's `isSupported()` once on mount and caches the
 * result as render state, mirroring `useAppleIntelligenceSupported`'s
 * undefined-while-probing / boolean-once-resolved shape so `AssistantSection` gates the
 * Android system-model backend the same way it gates the other two on-device backends.
 * Resolves straight to `false` off a native platform, where the plugin does not exist
 * (dynamic import behind `Platform.isNative`, Native contract).
 *
 * The 'notReady' reason matters more here than it does on iOS: Apple's system model ships
 * with the OS, while AICore downloads Gemini Nano on request, so 'notReady' is the normal
 * first-run state and the settings UI turns it into a download button rather than a
 * dead end.
 *
 * Test seam: in test mode (`isAssistantTestMode()`), `window.__geminiNanoMockSupported`
 * (set by e2e steps) short-circuits the real Capacitor probe when defined, because
 * Chromium e2e has no native bridge to fake genuinely. `isAssistantTestMode()` is false in
 * production builds, so the branch never runs there. Mirrors
 * `window.__appleIntelligenceMockSupported`.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from '../lib/platform';
import { isAssistantTestMode } from '../lib/assistant/providers/provider';

declare global {
  interface Window {
    /** e2e-only: forces this hook's resolved value when `isAssistantTestMode()` is true,
     *  bypassing the real `Platform.isNative` + `GeminiNano.isSupported()` probe. Never set
     *  outside tests/steps. */
    __geminiNanoMockSupported?: boolean;
  }
}

export interface GeminiNanoSupport {
  /** undefined while the probe is in flight. */
  supported: boolean | undefined;
  /** The plugin's stated reason when unsupported: this device or Android build has no
   *  Gemini Nano ('platform'), or the weights are not downloaded yet ('notReady'). Absent
   *  when the probe rejected or the platform has no plugin at all. */
  reason?: 'platform' | 'notReady';
  /** Re-runs the probe. The settings UI calls this after a download completes, so the
   *  backend becomes selectable without restarting the app. */
  refresh: () => void;
}

export function useGeminiNanoSupported(): GeminiNanoSupport {
  const [support, setSupport] = useState<{ supported: boolean | undefined; reason?: 'platform' | 'notReady' }>({
    supported: undefined,
  });
  const [probeCount, setProbeCount] = useState(0);
  const refresh = useCallback(() => setProbeCount((n) => n + 1), []);

  useEffect(() => {
    if (isAssistantTestMode() && window.__geminiNanoMockSupported !== undefined) {
      setSupport({ supported: window.__geminiNanoMockSupported });
      return;
    }

    if (!Platform.isNative) {
      setSupport({ supported: false });
      return;
    }

    let cancelled = false;
    import('../plugins/gemini-nano')
      .then(({ GeminiNano }) => GeminiNano.isSupported())
      .then((result) => {
        if (!cancelled) setSupport({ supported: result.supported, reason: result.reason });
      })
      .catch(() => {
        if (!cancelled) setSupport({ supported: false });
      });

    return () => {
      cancelled = true;
    };
  }, [probeCount]);

  return { ...support, refresh };
}
