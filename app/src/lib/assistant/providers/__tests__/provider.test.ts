import { describe, it, expect, vi, afterEach } from 'vitest';
import { isAssistantTestMode, getAssistantProvider } from '../provider';
import { sharedMockProvider } from '../mock';
import { WebLlmProvider } from '../webllm';
import { OpenAiProvider } from '../openai';
import { NativeLlmProvider } from '../native-llm';
import { AppleIntelligenceProvider } from '../apple-intelligence';
import { STORAGE_KEYS } from '../../../zmninja-ng-constants';
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
