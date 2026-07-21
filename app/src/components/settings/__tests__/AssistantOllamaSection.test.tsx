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
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantOllamaSection } from '../AssistantOllamaSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';

const listOpenAiModelsMock = vi.fn();
const probeToolSupportMock = vi.fn().mockResolvedValue('supported');
vi.mock('../../../lib/assistant/providers/openai', () => ({
  listOpenAiModels: (baseUrl: string, apiKey?: string, timeoutMs?: number) =>
    listOpenAiModelsMock(baseUrl, apiKey, timeoutMs),
  probeToolSupport: (baseUrl: string, model: string, apiKey?: string) =>
    probeToolSupportMock(baseUrl, model, apiKey),
  // Not mocked away: the section uses it to derive the URL placeholder and the
  // fallback base URL from the profile, and stubbing it would hide that.
  suggestOllamaBaseUrl: (url: string | undefined) =>
    url ? `http://${new URL(url).hostname}:11434/v1` : undefined,
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
  const profile = { id: 'p1', apiUrl: 'http://192.168.1.50/zm/api' } as never;
  // With no URL saved, the section falls back to the profile's ZoneMinder host.
  const OLLAMA_URL = 'http://192.168.1.50:11434/v1';
  const settings = {
    ...DEFAULT_SETTINGS,
    assistantBackend: 'ollama' as const,
    // The test button targets a model, so it stays disabled until one is set.
    assistantOllamaModel: 'llama3.2',
  };

  beforeEach(() => {
    listOpenAiModelsMock.mockReset().mockResolvedValue([]);
    probeToolSupportMock.mockReset().mockResolvedValue('supported');
    toastMock.mockReset();
  });

  it('shows the GPU and Gemma 4 guidance', () => {
    render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

    expect(screen.getByText('settings.assistant.ollama_url_hint')).toBeInTheDocument();
    expect(screen.getByText('settings.assistant.ollama_model_hint')).toBeInTheDocument();
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
        OLLAMA_URL,
        undefined,
        ASSISTANT.testConnectionTimeoutMs,
      );
      expect(ASSISTANT.testConnectionTimeoutMs).toBeLessThan(ASSISTANT.requestTimeoutMs);
    });

    // `main.tsx` renders the app inside <StrictMode>, which mounts, unmounts
    // and remounts every component once. A mounted-flag ref whose effect only
    // clears the flag on cleanup stays false forever after that remount, so
    // every state update guarded by it is dropped and the button strands in
    // "Testing...". Plain `render` never double-invokes, so this is the only
    // shape of test that catches it.
    it('returns to the idle label under StrictMode double-mounting', async () => {
      render(
        <StrictMode>
          <AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />
        </StrictMode>
      );

      const button = screen.getByTestId('assistant-ollama-test');
      fireEvent.click(button);

      await waitFor(() => expect(button).toHaveTextContent('settings.assistant.ollama_test'));
      expect(button).not.toBeDisabled();
    });

    it('reports how many models were found on a successful test', async () => {
      listOpenAiModelsMock.mockResolvedValue(['gemma2', 'qwen2.5:3b']);
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      const button = screen.getByTestId('assistant-ollama-test');
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveTextContent('settings.assistant.ollama_test'));

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'settings.assistant.ollama_test_ok' }),
      );
    });
  });

  describe('test stages', () => {
    it('names the stage being waited on instead of a bare Testing label', async () => {
      let release: (v: string[]) => void = () => {};
      listOpenAiModelsMock.mockReturnValue(new Promise((r) => (release = r)));
      // The probe never settles, so the second stage stays on screen long
      // enough to assert on: that is the stage a real cold model sits in.
      probeToolSupportMock.mockReturnValue(new Promise(() => {}));
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      fireEvent.click(screen.getByTestId('assistant-ollama-test'));
      expect(screen.getByTestId('assistant-ollama-test-status')).toHaveTextContent(
        'settings.assistant.ollama_test_connecting',
      );

      release([]);
      await waitFor(() =>
        expect(screen.getByTestId('assistant-ollama-test-status')).toHaveTextContent(
          'settings.assistant.ollama_test_probing',
        ),
      );
    });

    it('blames the clock, not the model, when the probe times out', async () => {
      probeToolSupportMock.mockResolvedValue('timeout');
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      fireEvent.click(screen.getByTestId('assistant-ollama-test'));
      await waitFor(() => expect(toastMock).toHaveBeenCalled());
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'settings.assistant.ollama_model_timeout_title' }),
      );
    });

    it('clears the stage line once the test finishes', async () => {
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);

      fireEvent.click(screen.getByTestId('assistant-ollama-test'));
      await waitFor(() =>
        expect(screen.queryByTestId('assistant-ollama-test-status')).not.toBeInTheDocument(),
      );
    });
  });

  describe('model picker', () => {
    it('auto-fetches models on mount and shows the manual input while empty', async () => {
      // No saved model either: a saved one is always offered in the dropdown,
      // which would give the picker an entry and hide the manual input.
      render(
        <AssistantOllamaSection
          settings={{ ...settings, assistantOllamaModel: '' }}
          update={vi.fn()}
          currentProfile={profile}
        />,
      );

      await waitFor(() =>
        expect(listOpenAiModelsMock).toHaveBeenCalledWith(OLLAMA_URL, undefined, undefined),
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
      // The saved model is always offered, even when the server did not list it.
      expect(options).toEqual(['gemma2', 'qwen2.5:3b', 'llama3.2']);

      fireEvent.change(select, { target: { value: 'gemma2' } });
      expect(update).toHaveBeenCalledWith('assistantOllamaModel', 'gemma2');

      // Manual override input stays visible alongside the select.
      expect(screen.getByTestId('assistant-ollama-model')).toBeInTheDocument();
    });

    // The recommendation is a TAGGED id (qwen3:8b): a sibling tag is a
    // different model with different measured scores, so only the exact id
    // hides the "pull it" hint.
    it('shows the pull hint until the exact recommended model is served', async () => {
      listOpenAiModelsMock.mockResolvedValue(['qwen3:0.6b', 'gemma2']);
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);
      await waitFor(() => expect(listOpenAiModelsMock).toHaveBeenCalled());
      expect(await screen.findByTestId('assistant-ollama-recommended-missing')).toBeInTheDocument();
    });

    it('hides the pull hint when the recommended model is served', async () => {
      listOpenAiModelsMock.mockResolvedValue(['qwen3:8b']);
      render(<AssistantOllamaSection settings={settings} update={vi.fn()} currentProfile={profile} />);
      await waitFor(() => expect(listOpenAiModelsMock).toHaveBeenCalled());
      expect(screen.queryByTestId('assistant-ollama-recommended-missing')).not.toBeInTheDocument();
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
