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

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: vi.fn(),
  deleteModel: vi.fn(),
}));

let webGpuAvailable: boolean | undefined = true;
vi.mock('../../../hooks/useWebGpuAvailable', () => ({
  useWebGpuAvailable: () => webGpuAvailable,
}));

// Mutable so a test can stand in for a mobile platform. The real Platform reads
// Capacitor, which reports 'web' in jsdom, so without this every test is desktop.
let isIOS = false;
let isAndroid = false;
vi.mock('../../../lib/platform', () => ({
  Platform: {
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
    isIOS = false;
    isAndroid = false;
  });

  // On-device is gated off on BOTH mobile platforms for memory: iOS jetsams a
  // WKWebView at 2 GB, Android kills the renderer under low memory. Both have
  // WebGPU, so this is a distinct path from the no-WebGPU one (refs #246).
  describe('mobile gating', () => {
    it('disables the on-device option and shows the steer-to-Ollama notice on Android', async () => {
      isAndroid = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      const onDeviceOption = screen
        .getByTestId('assistant-backend-select')
        .querySelector('option[value="on-device"]');
      expect(onDeviceOption).toBeDisabled();
      expect(screen.getByTestId('assistant-mobile-unsupported')).toBeInTheDocument();
    });

    it('disables the on-device option and shows the steer-to-Ollama notice', async () => {
      isIOS = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );

      const onDeviceOption = screen
        .getByTestId('assistant-backend-select')
        .querySelector('option[value="on-device"]');
      expect(onDeviceOption).toBeDisabled();
      // The iOS memory notice, not the no-WebGPU one: iOS has WebGPU.
      expect(screen.getByTestId('assistant-mobile-unsupported')).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-no-webgpu')).not.toBeInTheDocument();
    });

    it('never shows the model download UI on iOS, even with WebGPU present', () => {
      isIOS = true;
      webGpuAvailable = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      expect(screen.queryByTestId('assistant-model-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('assistant-model-download')).not.toBeInTheDocument();
    });

    it('keeps the iOS notice visible even after switching to Ollama', () => {
      isIOS = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'ollama' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      // The greyed on-device option needs an explanation whichever backend is
      // active, so the note stays put next to the picker.
      expect(screen.getByTestId('assistant-mobile-unsupported')).toBeInTheDocument();
      expect(screen.getByTestId('assistant-ollama-url')).toBeInTheDocument();
    });

    it('leaves on-device selectable on desktop (neither mobile platform)', async () => {
      isIOS = false;
      isAndroid = false;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      await waitFor(() => expect(isModelDownloadedMock).toHaveBeenCalled());
      const onDeviceOption = screen
        .getByTestId('assistant-backend-select')
        .querySelector('option[value="on-device"]');
      expect(onDeviceOption).not.toBeDisabled();
      expect(screen.queryByTestId('assistant-mobile-unsupported')).not.toBeInTheDocument();
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
