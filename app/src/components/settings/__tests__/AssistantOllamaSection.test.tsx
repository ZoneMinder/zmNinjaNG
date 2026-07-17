/**
 * AssistantOllamaSection test-connection button and model picker (refs #246)
 *
 * Covers two fixes: (1) the "Test connection" button returning to its idle
 * label after both a resolved and a rejected test (it used to strand in
 * "Testing..." because nothing tied the earlier http-timeout work back to a
 * `finally`-guarded local flag on this specific handler's paths), and (2)
 * `listOpenAiModels` feeding a `<select>` model picker, with a saved-but-not-
 * returned model still selectable and a failed fetch leaving the manual text
 * input usable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantOllamaSection } from '../AssistantOllamaSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';

const listOpenAiModelsMock = vi.fn();
vi.mock('../../../lib/assistant/providers/openai', () => ({
  listOpenAiModels: (baseUrl: string, apiKey?: string, timeoutMs?: number) =>
    listOpenAiModelsMock(baseUrl, apiKey, timeoutMs),
}));

vi.mock('../../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(null),
  hasSecureValue: vi.fn().mockResolvedValue(false),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: Record<string, unknown> | string) => (typeof d === 'string' ? d : k) }),
}));

const toastMock = vi.fn();
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe('AssistantOllamaSection', () => {
  const profile = { id: 'p1' } as never;
  const settings = { ...DEFAULT_SETTINGS, assistantBackend: 'ollama' as const };

  beforeEach(() => {
    listOpenAiModelsMock.mockReset().mockResolvedValue([]);
    toastMock.mockReset();
  });

  describe('Test connection button', () => {
    it('returns to the idle label after a resolved test', async () => {
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      const button = screen.getByTestId('assistant-ollama-test');
      fireEvent.click(button);
      expect(button).toHaveTextContent('settings.assistant.ollama_testing');

      await waitFor(() => expect(button).toHaveTextContent('settings.assistant.ollama_test'));
      expect(button).not.toBeDisabled();
    });

    it('returns to the idle label after a rejected test', async () => {
      listOpenAiModelsMock.mockRejectedValue(new Error('Connection refused'));
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      const button = screen.getByTestId('assistant-ollama-test');
      fireEvent.click(button);
      expect(button).toHaveTextContent('settings.assistant.ollama_testing');

      await waitFor(() => expect(button).toHaveTextContent('settings.assistant.ollama_test'));
      expect(button).not.toBeDisabled();
      await waitFor(() => expect(toastMock).toHaveBeenCalled());
    });

    it('uses the short reachability timeout, not the full chat request timeout (refs #246)', async () => {
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      const button = screen.getByTestId('assistant-ollama-test');
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveTextContent('settings.assistant.ollama_test'));

      expect(listOpenAiModelsMock).toHaveBeenLastCalledWith(
        settings.assistantOllamaBaseUrl,
        undefined,
        ASSISTANT.testConnectionTimeoutMs,
      );
      expect(ASSISTANT.testConnectionTimeoutMs).toBeLessThan(ASSISTANT.requestTimeoutMs);
    });

    it('reports how many models were found on a successful test', async () => {
      listOpenAiModelsMock.mockResolvedValue(['gemma2', 'qwen2.5:3b']);
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      const button = screen.getByTestId('assistant-ollama-test');
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveTextContent('settings.assistant.ollama_test'));

      expect(toastMock).toHaveBeenCalledWith({ title: 'settings.assistant.ollama_test_ok_models' });
    });
  });

  describe('model picker', () => {
    it('auto-fetches models on mount and shows the manual input while empty', async () => {
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      await waitFor(() =>
        expect(listOpenAiModelsMock).toHaveBeenCalledWith(settings.assistantOllamaBaseUrl, undefined, undefined),
      );
      expect(screen.getByTestId('assistant-ollama-model')).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-ollama-model-select')).not.toBeInTheDocument();
    });

    it('populates the select after a refresh click and selecting an option updates assistantOllamaModel', async () => {
      listOpenAiModelsMock.mockResolvedValue(['gemma2', 'qwen2.5:3b']);
      const update = vi.fn();
      render(<AssistantOllamaSection settings={settings} update={update} currentProfile={profile} />);

      await waitFor(() => expect(listOpenAiModelsMock).toHaveBeenCalled());
      fireEvent.click(screen.getByTestId('assistant-ollama-refresh-models'));

      const select = await screen.findByTestId('assistant-ollama-model-select');
      const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
      expect(options).toEqual(['gemma2', 'qwen2.5:3b']);

      fireEvent.change(select, { target: { value: 'gemma2' } });
      expect(update).toHaveBeenCalledWith('assistantOllamaModel', 'gemma2');

      // Manual override input stays visible alongside the select.
      expect(screen.getByTestId('assistant-ollama-model')).toBeInTheDocument();
    });

    it('includes the saved model in the dropdown even if the fetch did not return it', async () => {
      listOpenAiModelsMock.mockResolvedValue(['gemma2']);
      render(
        <AssistantOllamaSection
          settings={{ ...settings, assistantOllamaModel: 'custom-model-not-returned' }}
          update={vi.fn()}
          currentProfile={profile}
        />
      );

      const select = await screen.findByTestId('assistant-ollama-model-select');
      const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
      expect(options).toContain('custom-model-not-returned');
      expect(options).toContain('gemma2');
    });

    it('leaves the manual input usable and does not crash when the fetch is rejected', async () => {
      listOpenAiModelsMock.mockRejectedValue(new Error('Network error'));
      const update = vi.fn();
      render(<AssistantOllamaSection settings={settings} update={update} currentProfile={profile} />);

      await waitFor(() => expect(toastMock).toHaveBeenCalled());
      expect(screen.queryByTestId('assistant-ollama-model-select')).not.toBeInTheDocument();

      const input = screen.getByTestId('assistant-ollama-model');
      fireEvent.change(input, { target: { value: 'typed-model' } });
      expect(update).toHaveBeenCalledWith('assistantOllamaModel', 'typed-model');
    });
  });
});
