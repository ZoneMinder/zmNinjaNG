/**
 * AssistantSection backend picker and gating (refs #246)
 *
 * Covers the parts of `AssistantSection.tsx` added for the Ollama backend:
 * the backend `<select>` swaps between the on-device sub-section and
 * `AssistantOllamaSection`, and the master enable toggle is reachable
 * regardless of WebGPU availability (only the on-device model picker used to
 * disable itself on "no WebGPU"; the toggle itself never did, and this test
 * pins that down explicitly since it's easy to regress).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantSection } from '../AssistantSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';

const isModelDownloadedMock = vi.fn().mockResolvedValue(false);

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: vi.fn(),
  deleteModel: vi.fn(),
}));

let webGpuAvailable: boolean | undefined = true;
vi.mock('../../../hooks/useWebGpuAvailable', () => ({
  useWebGpuAvailable: () => webGpuAvailable,
}));

vi.mock('../../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(null),
  hasSecureValue: vi.fn().mockResolvedValue(false),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/http', () => ({
  // Resolved (not a bare vi.fn()): AssistantOllamaSection auto-fetches the
  // model list on mount (refs #246 Fix 2), so an unresolved mock here would
  // reject inside that effect and log a spurious act() warning in tests that
  // never assert on the model picker.
  httpGet: vi.fn().mockResolvedValue({ data: { data: [] } }),
  httpPost: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: Record<string, unknown> | string) => (typeof d === 'string' ? d : k) }),
}));

vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('AssistantSection backend picker and gating', () => {
  const profile = { id: 'p1' } as never;
  const enabledSettings = { ...DEFAULT_SETTINGS, assistantEnabled: true };

  beforeEach(() => {
    isModelDownloadedMock.mockReset().mockResolvedValue(false);
    webGpuAvailable = true;
  });

  it('shows the on-device model picker by default and hides the Ollama fields', async () => {
    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );
    await waitFor(() => expect(isModelDownloadedMock).toHaveBeenCalled());

    expect(screen.getByTestId('assistant-backend-select')).toHaveValue('on-device');
    expect(screen.getByTestId('assistant-model-select')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-ollama-url')).not.toBeInTheDocument();
  });

  it('switches to the Ollama sub-section and hides the on-device picker when the backend changes', async () => {
    const update = vi.fn();
    const { rerender } = render(
      <AssistantSection
        settings={enabledSettings}
        update={update}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );
    await waitFor(() => expect(isModelDownloadedMock).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('assistant-backend-select'), { target: { value: 'ollama' } });
    expect(update).toHaveBeenCalledWith('assistantBackend', 'ollama');

    rerender(
      <AssistantSection
        settings={{ ...enabledSettings, assistantBackend: 'ollama' }}
        update={update}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    expect(screen.getByTestId('assistant-ollama-url')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-ollama-model')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-ollama-key')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-ollama-test')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-model-select')).not.toBeInTheDocument();

    // Lets AssistantOllamaSection's mount-effect model fetch (refs #246 Fix
    // 2) settle inside `act` instead of leaking a state update past the end
    // of the test.
    await waitFor(() => expect(screen.getByTestId('assistant-ollama-model')).toBeInTheDocument());
  });

  it('keeps the enable toggle on and clickable when WebGPU is unavailable', async () => {
    webGpuAvailable = false;
    const update = vi.fn();

    render(
      <AssistantSection
        settings={enabledSettings}
        update={update}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const toggle = screen.getByTestId('assistant-enabled-toggle');
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('data-state', 'checked');

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith('assistantEnabled', false);

    // The backend picker itself is still reachable (it's the on-device
    // sub-part, not the toggle, that explains "no WebGPU").
    expect(screen.getByTestId('assistant-backend-select')).not.toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('assistant-no-webgpu')).toBeInTheDocument());
  });

  it('renders the toggle even when the enabled flag is off, independent of WebGPU', async () => {
    webGpuAvailable = false;
    render(
      <AssistantSection
        settings={{ ...DEFAULT_SETTINGS, assistantEnabled: false }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );
    await waitFor(() => expect(isModelDownloadedMock).toHaveBeenCalled());

    expect(screen.getByTestId('assistant-enabled-toggle')).not.toBeDisabled();
    expect(screen.queryByTestId('assistant-backend-select')).not.toBeInTheDocument();
  });
});
