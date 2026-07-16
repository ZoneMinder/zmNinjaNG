import type { AssistantProvider } from '../types';
import { STORAGE_KEYS } from '../../zmninja-ng-constants';
import { sharedMockProvider } from './mock';
import { WebLlmProvider } from './webllm';
import { MODEL_NOT_AVAILABLE_MESSAGE } from '../model-download';

/** `getAssistantProvider` itself never throws this outside test mode (it
 *  always returns a `WebLlmProvider`); the message is thrown instead by
 *  `WebLlmProvider.chat` -> `getLoadedEngine` when the selected model has no
 *  cached weights. Re-exported under this name so the one caller (AskPanel)
 *  keeps comparing against a single literal regardless of which layer throws
 *  it. */
export const PROVIDER_NOT_AVAILABLE_MESSAGE = MODEL_NOT_AVAILABLE_MESSAGE;

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

/** Returns the mock in test mode, otherwise the on-device WebLLM provider for
 *  `modelId`. `modelId` is ignored in test mode: the shared mock is scripted
 *  by the caller (e.g. e2e steps), not tied to any model. */
export function getAssistantProvider(modelId: string): AssistantProvider {
  if (isAssistantTestMode()) return sharedMockProvider;
  return new WebLlmProvider(modelId);
}
