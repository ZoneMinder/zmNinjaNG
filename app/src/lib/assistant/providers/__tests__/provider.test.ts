import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TFunction } from 'i18next';
import { isAssistantTestMode, getAssistantProvider, assistantBackendLabel } from '../provider';
import { sharedMockProvider } from '../mock';
import { WebLlmProvider } from '../webllm';
import { OpenAiProvider } from '../openai';
import { NativeLlmProvider } from '../native-llm';
import { AppleIntelligenceProvider } from '../apple-intelligence';
import { ASSISTANT, STORAGE_KEYS } from '../../../zmninja-ng-constants';
import type { ProviderConfig } from '../../types';

const MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';

const onDeviceConfig: ProviderConfig = {
  backend: 'on-device',
  modelId: MODEL_ID,
  ollamaBaseUrl: 'http://localhost:11434/v1',
  ollamaModel: '',
};

const ollamaConfig: ProviderConfig = {
  backend: 'ollama',
  modelId: MODEL_ID,
  ollamaBaseUrl: 'http://localhost:11434/v1',
  ollamaModel: 'qwen2.5:3b',
};

const nativeConfig: ProviderConfig = {
  backend: 'native',
  modelId: MODEL_ID,
  ollamaBaseUrl: 'http://localhost:11434/v1',
  ollamaModel: '',
};

const appleConfig: ProviderConfig = {
  backend: 'apple',
  modelId: MODEL_ID,
  ollamaBaseUrl: 'http://localhost:11434/v1',
  ollamaModel: '',
};

describe('isAssistantTestMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('returns false in production even when the localStorage flag is set', () => {
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');
    vi.stubEnv('PROD', true);

    expect(isAssistantTestMode()).toBe(false);
  });

  it('returns true outside production when the flag is set', () => {
    vi.stubEnv('PROD', false);
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');

    expect(isAssistantTestMode()).toBe(true);
  });

  it('returns false outside production when the flag is absent', () => {
    vi.stubEnv('PROD', false);

    expect(isAssistantTestMode()).toBe(false);
  });

  it('returns false instead of throwing when localStorage access throws', () => {
    vi.stubEnv('PROD', false);
    const original = global.localStorage.getItem;
    vi.spyOn(global.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(isAssistantTestMode()).toBe(false);

    global.localStorage.getItem = original;
  });
});

describe('getAssistantProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('returns the shared mock provider in test mode, ignoring the backend', () => {
    vi.stubEnv('PROD', false);
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');

    expect(getAssistantProvider(onDeviceConfig)).toBe(sharedMockProvider);
    expect(getAssistantProvider(ollamaConfig)).toBe(sharedMockProvider);
    expect(getAssistantProvider(nativeConfig)).toBe(sharedMockProvider);
    expect(getAssistantProvider(appleConfig)).toBe(sharedMockProvider);
  });

  it('returns a WebLlmProvider for backend "on-device" when not in test mode', () => {
    vi.stubEnv('PROD', false);

    expect(getAssistantProvider(onDeviceConfig)).toBeInstanceOf(WebLlmProvider);
  });

  it('returns an OpenAiProvider for backend "ollama" when not in test mode', () => {
    vi.stubEnv('PROD', false);

    expect(getAssistantProvider(ollamaConfig)).toBeInstanceOf(OpenAiProvider);
  });

  it('returns a WebLlmProvider in production even if the localStorage flag is set', () => {
    vi.stubEnv('PROD', true);
    localStorage.setItem(STORAGE_KEYS.assistantTestMode, '1');

    expect(getAssistantProvider(onDeviceConfig)).toBeInstanceOf(WebLlmProvider);
  });

  it('returns a NativeLlmProvider for backend "native" when not in test mode', () => {
    vi.stubEnv('PROD', false);

    expect(getAssistantProvider(nativeConfig)).toBeInstanceOf(NativeLlmProvider);
  });

  it('returns an AppleIntelligenceProvider for backend "apple" when not in test mode', () => {
    vi.stubEnv('PROD', false);

    expect(getAssistantProvider(appleConfig)).toBeInstanceOf(AppleIntelligenceProvider);
  });
});

describe('assistantBackendLabel', () => {
  // Minimal t stub: returns the key. The label composes "<model> · <key>", so
  // asserting on the raw key is enough to prove the right mode was chosen.
  const t = ((key: string) => key) as unknown as TFunction;

  it('shows the WebLLM catalog label for the on-device backend', () => {
    const label = assistantBackendLabel(
      { assistantBackend: 'on-device', assistantModelId: ASSISTANT.webllmModels[0].id, assistantOllamaModel: '' },
      t,
    );
    expect(label).toBe(`${ASSISTANT.webllmModels[0].label} · settings.assistant.backend_on_device`);
  });

  it('shows the Ollama model name for the ollama backend', () => {
    const label = assistantBackendLabel(
      { assistantBackend: 'ollama', assistantModelId: '', assistantOllamaModel: 'qwen3:8b' },
      t,
    );
    expect(label).toBe('qwen3:8b · settings.assistant.backend_ollama');
  });

  it('shows the fixed native model label for the native backend', () => {
    const label = assistantBackendLabel(
      { assistantBackend: 'native', assistantModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', assistantOllamaModel: '' },
      t,
    );
    expect(label).toBe(`${ASSISTANT.nativeLlmModel.label} · settings.assistant.backend_on_device`);
    // Never leaks a selected WebLLM model id on a non-WebLLM backend.
    expect(label).not.toContain('Llama-3.2');
  });

  it('shows the Apple Intelligence brand for the apple backend, not the WebLLM catalog', () => {
    const label = assistantBackendLabel(
      { assistantBackend: 'apple', assistantModelId: ASSISTANT.webllmModels[0].id, assistantOllamaModel: '' },
      t,
    );
    expect(label).toBe('Apple Intelligence · settings.assistant.backend_on_device');
    expect(label).not.toContain(ASSISTANT.webllmModels[0].label);
  });
});
