/**
 * Header chrome label (refs #270): the backend label must name the model the
 * active backend actually runs, not fall through to the WebLLM catalog when
 * the native backend is selected.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { useAssistantChrome } from '../useAssistantChrome';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import type { ProfileSettings } from '../../../stores/settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function seed(settings: Partial<ProfileSettings>) {
  seedProfiles(['p1'], { settings: { p1: settings } });
}

describe('useAssistantChrome backendLabel', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('names the native model when the native backend is selected', () => {
    seed({ assistantBackend: 'native', assistantModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', assistantOllamaModel: '' });
    const { result } = renderHook(() => useAssistantChrome());
    expect(result.current.backendLabel).toContain(ASSISTANT.nativeLlmModel.label);
    expect(result.current.backendLabel).not.toContain('Llama');
  });

  it('keeps the WebLLM catalog label for the on-device backend', () => {
    seed({ assistantBackend: 'on-device', assistantModelId: ASSISTANT.webllmModels[0].id, assistantOllamaModel: '' });
    const { result } = renderHook(() => useAssistantChrome());
    expect(result.current.backendLabel).toContain(ASSISTANT.webllmModels[0].label);
  });

  it('shows the Ollama model for the ollama backend', () => {
    seed({ assistantBackend: 'ollama', assistantModelId: '', assistantOllamaModel: 'qwen3:8b' });
    const { result } = renderHook(() => useAssistantChrome());
    expect(result.current.backendLabel).toContain('qwen3:8b');
  });
});
