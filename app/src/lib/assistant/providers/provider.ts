import type { AssistantProvider } from '../types';
import { STORAGE_KEYS } from '../../zmninja-ng-constants';
import { sharedMockProvider } from './mock';

/** True only in non-production builds when the test flag is set. Keeps the
 *  mock backend unreachable in a shipped release. */
export function isAssistantTestMode(): boolean {
  if (import.meta.env.PROD) return false;
  try {
    return localStorage.getItem(STORAGE_KEYS.assistantTestMode) === '1';
  } catch {
    return false;
  }
}

/** Returns the mock in test mode, otherwise the on-device WebLLM provider.
 *  Phase 1 throws for the real path; Phase 2 wires WebLLM here. */
export function getAssistantProvider(): AssistantProvider {
  if (isAssistantTestMode()) return sharedMockProvider;
  throw new Error('On-device model backend is not available yet.');
}
