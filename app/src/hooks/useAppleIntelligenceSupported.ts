/**
 * useAppleIntelligenceSupported Hook (refs #270)
 *
 * Probes the native `AppleIntelligence` plugin's `isSupported()` once on mount
 * and caches the result as render state, mirroring `useNativeLlmSupported`'s
 * undefined-while-probing / boolean-once-resolved shape so `AssistantSection`
 * gates the Apple Foundation Models (system LLM) backend option the same way
 * it gates the llama.cpp bridge. Resolves straight to `false` off a native
 * platform, where the plugin does not exist at all (dynamic import behind
 * `Platform.isNative`, rule 13).
 *
 * Test seam: in test mode (`isAssistantTestMode()`), `window.__appleIntelligenceMockSupported`
 * (set by e2e steps) short-circuits the real Capacitor probe when defined,
 * because Chromium e2e has no native bridge to fake genuinely (`Platform.isNative`
 * is always false there, and `AppleIntelligence` has no `web` jsImplementation,
 * so a real `isSupported()` call always rejects). This is the only
 * production-visible test seam this hook adds; `isAssistantTestMode()` is
 * false in production builds, so the branch never runs there. Mirrors
 * `window.__nativeLlmMockSupported` in useNativeLlmSupported.ts.
 */

import { useEffect, useState } from 'react';
import { Platform } from '../lib/platform';
import { isAssistantTestMode } from '../lib/assistant/providers/provider';

declare global {
  interface Window {
    /** e2e-only: forces this hook's resolved value when `isAssistantTestMode()`
     *  is true, bypassing the real `Platform.isNative` + `AppleIntelligence.isSupported()`
     *  probe. Never set outside tests/steps. */
    __appleIntelligenceMockSupported?: boolean;
  }
}

export interface AppleIntelligenceSupport {
  /** undefined while the probe is in flight. */
  supported: boolean | undefined;
  /** The plugin's stated reason when unsupported: the OS lacks the model
   *  ('platform'), the user turned Apple Intelligence off ('disabled'), or it
   *  is still provisioning ('notReady'). Absent when the probe rejected or the
   *  platform has no plugin at all, so the UI can distinguish "not available
   *  here" from "turn it on in Settings". */
  reason?: 'platform' | 'disabled' | 'notReady';
}

export function useAppleIntelligenceSupported(): AppleIntelligenceSupport {
  const [support, setSupport] = useState<AppleIntelligenceSupport>({ supported: undefined });

  useEffect(() => {
    if (isAssistantTestMode() && window.__appleIntelligenceMockSupported !== undefined) {
      setSupport({ supported: window.__appleIntelligenceMockSupported });
      return;
    }

    if (!Platform.isNative) {
      setSupport({ supported: false });
      return;
    }

    let cancelled = false;
    import('../plugins/apple-intelligence')
      .then(({ AppleIntelligence }) => AppleIntelligence.isSupported())
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
