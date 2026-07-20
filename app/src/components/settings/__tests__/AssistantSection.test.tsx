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
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';

const isModelDownloadedMock = vi.fn().mockResolvedValue(false);
const { useCapacitorListenerMock } = vi.hoisted(() => ({ useCapacitorListenerMock: vi.fn() }));

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: vi.fn(),
  deleteModel: vi.fn(),
}));

vi.mock('../../../hooks/useCapacitorListener', () => ({ useCapacitorListener: useCapacitorListenerMock }));

let webGpuAvailable: boolean | undefined = true;
vi.mock('../../../hooks/useWebGpuAvailable', () => ({
  useWebGpuAvailable: () => webGpuAvailable,
}));

// Mutable so a test can stand in for a mobile platform. The real Platform reads
// Capacitor, which reports 'web' in jsdom, so without this every test is desktop.
let isIOS = false;
let isAndroid = false;
let isNative = false;
vi.mock('../../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return isNative;
    },
    get isIOS() {
      return isIOS;
    },
    get isAndroid() {
      return isAndroid;
    },
  },
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
  useTranslation: () => ({
    t: (k: string, d?: Record<string, unknown> | string) => {
      if (k === 'settings.assistant.native_download_current' && typeof d === 'object') {
        return `${k}:${d.fileName}:${d.current}/${d.total}:${d.progress}%:${d.downloaded}/${d.size}`;
      }
      if (k === 'settings.assistant.storage_used' && typeof d === 'object') {
        return `${k}:${d.size}`;
      }
      if (k === 'settings.assistant.native_download_summary' && typeof d === 'object') {
        return `${k}:${d.completed}:${d.pending}`;
      }
      return typeof d === 'string' ? d : k;
    },
  }),
}));

vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('AssistantSection backend picker and gating', () => {
  const profile = { id: 'p1' } as never;
  const enabledSettings = { ...DEFAULT_SETTINGS, assistantEnabled: true };

  beforeEach(() => {
    isModelDownloadedMock.mockReset().mockResolvedValue(false);
    useCapacitorListenerMock.mockReset();
    webGpuAvailable = true;
    isIOS = false;
    isAndroid = false;
    isNative = false;
  });

  // On-device was removed on phones and tablets. The picker must not offer a
  // backend with no implementation, and the absence has to be explained or a
  // missing feature reads as a bug.
  describe('on a phone or tablet', () => {
    it('replaces the backend picker with a note and shows the Ollama settings', async () => {
      isNative = true;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      expect(await screen.findByTestId('assistant-on-device-unavailable')).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-backend-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('assistant-ollama-url')).toBeInTheDocument();
    });

    it('never shows the on-device model picker, even with the setting still on-device', async () => {
      isNative = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'on-device' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      await screen.findByTestId('assistant-on-device-unavailable');
      expect(screen.queryByTestId('assistant-model-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('assistant-model-download')).not.toBeInTheDocument();
    });
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
    expect(screen.getByText('settings.assistant.on_device_ollama_hint')).toBeInTheDocument();
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

  it('shows Ninjii\'s logo in the enable row, before the toggle (refs #246)', () => {
    const { container } = render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const logo = container.querySelector(`img[src="${ASSISTANT.logoPath}"]`);
    expect(logo).toBeInTheDocument();
    // Decorative: the row's label already names Ninjii, so an alt text here
    // would make a screen reader announce the name twice.
    expect(logo).toHaveAttribute('alt', '');

    // Ordered label, logo, toggle within the row: the logo reads as trailing
    // the text rather than leading it.
    const toggle = screen.getByTestId('assistant-enabled-toggle');
    const position = logo!.compareDocumentPosition(toggle);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
