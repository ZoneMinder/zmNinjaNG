/**
 * Header chrome label (refs #270): the backend label must name the model the
 * active backend actually runs, not fall through to the WebLLM catalog when
 * the native backend is selected.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAssistantChrome } from '../useAssistantChrome';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';
import type { ProfileSettings } from '../../../stores/settings';

const state: { settings: Partial<ProfileSettings> } = { settings: {} };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: state.settings }),
}));

describe('useAssistantChrome backendLabel', () => {
  it('names the native model when the native backend is selected', () => {
    state.settings = { assistantBackend: 'native', assistantModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', assistantOllamaModel: '' };
    const { result } = renderHook(() => useAssistantChrome());
    expect(result.current.backendLabel).toContain(ASSISTANT.nativeLlmModel.label);
    expect(result.current.backendLabel).not.toContain('Llama');
  });

  it('keeps the WebLLM catalog label for the on-device backend', () => {
    state.settings = { assistantBackend: 'on-device', assistantModelId: ASSISTANT.webllmModels[0].id, assistantOllamaModel: '' };
    const { result } = renderHook(() => useAssistantChrome());
    expect(result.current.backendLabel).toContain(ASSISTANT.webllmModels[0].label);
  });

  it('shows the Ollama model for the ollama backend', () => {
    state.settings = { assistantBackend: 'ollama', assistantModelId: '', assistantOllamaModel: 'qwen3:8b' };
    const { result } = renderHook(() => useAssistantChrome());
    expect(result.current.backendLabel).toContain('qwen3:8b');
  });
});
