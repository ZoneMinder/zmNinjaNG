import type { TFunction } from 'i18next';
import type { AssistantProvider, ProviderConfig } from '../types';
import type { ProfileSettings } from '../../../stores/settings';
import { ASSISTANT, STORAGE_KEYS } from '../../zmninja-ng-constants';
import { sharedMockProvider } from './mock';
import { WebLlmProvider } from './webllm';
import { OpenAiProvider } from './openai';
import { NativeLlmProvider } from './native-llm';
import { AppleIntelligenceProvider } from './apple-intelligence';
import { GeminiNanoProvider } from './gemini-nano';
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

/** Returns the mock in test mode, otherwise the provider for `config.backend`:
 *  the on-device WebLLM provider (`config.modelId`), the OpenAI-compatible
 *  remote adapter (`config.ollamaBaseUrl`/`config.ollamaModel`/`config.apiKey`)
 *  for Ollama, the native llama.cpp bridge (refs #270) for 'native', or Apple
 *  Foundation Models (refs #270) for 'apple', or Gemini Nano over AICore (refs
 *  #270) for 'gemini-nano'. `config` is ignored in test mode:
 *  the shared mock is scripted by the caller (e.g. e2e steps), not tied to any
 *  backend or model. */
export function getAssistantProvider(config: ProviderConfig): AssistantProvider {
  if (isAssistantTestMode()) return sharedMockProvider;
  if (config.backend === 'ollama') {
    return new OpenAiProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      apiKey: config.apiKey,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
  }
  if (config.backend === 'native') return new NativeLlmProvider(config.temperature);
  if (config.backend === 'apple') return new AppleIntelligenceProvider(config.temperature);
  if (config.backend === 'gemini-nano') return new GeminiNanoProvider(config.temperature);
  return new WebLlmProvider(config.modelId, config.temperature);
}

/**
 * The chat header's backend label: the model the ACTIVE backend runs, plus
 * where it runs, composed as "<model> · <mode>" (mode alone when a backend has
 * no model string to show).
 *
 * The switch is EXHAUSTIVE on `AssistantBackend`; the
 * `const exhaustive: never = backend` default makes a new backend member added
 * without a label here FAIL tsc. That compile error is the feature: the header,
 * and any future surface, can never silently fall through to another backend's
 * model name -- which is exactly the 'apple'-shows-qwen bug this replaces
 * (refs #270).
 */
export function assistantBackendLabel(
  settings: Pick<ProfileSettings, 'assistantBackend' | 'assistantModelId' | 'assistantOllamaModel'>,
  t: TFunction,
): string {
  const backend = settings.assistantBackend;
  let model: string;
  let mode: string;
  switch (backend) {
    case 'on-device':
      model =
        ASSISTANT.webllmModels.find((m) => m.id === settings.assistantModelId)?.label ??
        settings.assistantModelId;
      mode = t('settings.assistant.backend_on_device');
      break;
    case 'ollama':
      model = settings.assistantOllamaModel;
      mode = t('settings.assistant.backend_ollama');
      break;
    case 'native':
      // Fixed single native model, so no catalog lookup; its label already says
      // "(native)", making the on-device mode suffix enough.
      model = ASSISTANT.nativeLlmModel.label;
      mode = t('settings.assistant.backend_on_device');
      break;
    case 'apple':
      // OS-owned model, no id to select; brand name, deliberately untranslated.
      model = 'Apple Intelligence';
      mode = t('settings.assistant.backend_on_device');
      break;
    case 'gemini-nano':
      // Same as Apple's: AICore owns the model, so the brand name is the label, untranslated.
      model = 'Gemini Nano';
      mode = t('settings.assistant.backend_on_device');
      break;
    default: {
      const exhaustive: never = backend;
      return exhaustive;
    }
  }
  return model ? `${model} · ${mode}` : mode;
}
