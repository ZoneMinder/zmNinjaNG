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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AssistantSection } from '../AssistantSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { NINJII_LOGO_URL } from '../../../lib/assistant/ninjii-logo';

const isModelDownloadedMock = vi.fn().mockResolvedValue(false);
const { useCapacitorListenerMock } = vi.hoisted(() => ({ useCapacitorListenerMock: vi.fn() }));

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: vi.fn(),
  deleteModel: vi.fn(),
  // Pulled in transitively now that the apple eval row imports
  // AppleIntelligenceProvider (which re-exports this constant).
  MODEL_NOT_AVAILABLE_MESSAGE: '__i18n:assistant.model_not_available',
}));

vi.mock('../../../hooks/useCapacitorListener', () => ({ useCapacitorListener: useCapacitorListenerMock }));

// Mutable so a test can stand in for a supported/unsupported native device.
// Defaults unsupported so every test that doesn't touch this explicitly keeps
// the pre-existing "note + forced Ollama" behavior on a native platform.
let nativeSupported: boolean | undefined = false;
let nativeUnsupportedReason: 'platform' | 'memory' | undefined;
vi.mock('../../../hooks/useNativeLlmSupported', () => ({
  useNativeLlmSupported: () => ({ supported: nativeSupported, reason: nativeUnsupportedReason }),
}));

// Same seam for the OS-hosted Apple Foundation Models backend. Defaults
// unsupported so existing tests keep their pre-apple behavior.
let appleSupported: boolean | undefined = false;
let appleUnsupportedReason: 'platform' | 'disabled' | 'notReady' | undefined;
vi.mock('../../../hooks/useAppleIntelligenceSupported', () => ({
  useAppleIntelligenceSupported: () => ({ supported: appleSupported, reason: appleUnsupportedReason }),
}));

// And the same seam for Android's system model. Unlike the other two, its
// 'notReady' is a state the UI can act on rather than just report, so the reason
// is exercised as well as the boolean.
let geminiSupported: boolean | undefined = false;
let geminiUnsupportedReason: 'platform' | 'notReady' | undefined;
const geminiRefresh = vi.fn();
vi.mock('../../../hooks/useGeminiNanoSupported', () => ({
  useGeminiNanoSupported: () => ({ supported: geminiSupported, reason: geminiUnsupportedReason, refresh: geminiRefresh }),
}));

const isNativeModelDownloadedMock = vi.fn().mockResolvedValue({ downloaded: false });
vi.mock('../../../lib/assistant/native-model-download', () => ({
  isNativeModelDownloaded: () => isNativeModelDownloadedMock(),
  downloadNativeModel: vi.fn(),
  deleteNativeModel: vi.fn(),
}));

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
    isNativeModelDownloadedMock.mockReset().mockResolvedValue({ downloaded: false });
    useCapacitorListenerMock.mockReset();
    webGpuAvailable = true;
    isIOS = false;
    isAndroid = false;
    isNative = false;
    nativeSupported = false;
    nativeUnsupportedReason = undefined;
    appleSupported = false;
    appleUnsupportedReason = undefined;
    geminiSupported = false;
    geminiUnsupportedReason = undefined;
    geminiRefresh.mockClear();
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

      expect(await screen.findByTestId('assistant-on-device-unavailable')).toHaveTextContent(
        'settings.assistant.on_device_mobile_disabled',
      );
      expect(screen.queryByTestId('assistant-backend-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('assistant-ollama-url')).toHaveValue('http://localhost:11434/v1');
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

  // Task 4 (refs #270): the native (llama.cpp bridge) backend replaces the
  // "on-device unavailable" note on a phone or tablet once the plugin's own
  // isSupported() probe passes.
  describe('native backend on a phone or tablet', () => {
    it('keeps the unavailable note and forces Ollama while the isSupported() probe is still in flight', async () => {
      isNative = true;
      nativeSupported = undefined;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      expect(await screen.findByTestId('assistant-on-device-unavailable')).toHaveTextContent(
        'settings.assistant.on_device_mobile_disabled',
      );
      expect(screen.queryByTestId('assistant-backend-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('assistant-ollama-url')).toHaveValue('http://localhost:11434/v1');
    });

    it('keeps the unavailable note and forces Ollama when the device fails the isSupported() probe', async () => {
      isNative = true;
      nativeSupported = false;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      expect(await screen.findByTestId('assistant-on-device-unavailable')).toHaveTextContent(
        'settings.assistant.on_device_mobile_disabled',
      );
      expect(screen.queryByTestId('assistant-backend-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('assistant-ollama-url')).toHaveValue('http://localhost:11434/v1');
    });

    it('names this device and the memory reason when the plugin reports reason "memory"', async () => {
      isNative = true;
      nativeSupported = false;
      nativeUnsupportedReason = 'memory';
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const note = await screen.findByTestId('assistant-on-device-unavailable');
      expect(within(note).getByText('settings.assistant.native_unsupported_memory')).toHaveTextContent(
        'settings.assistant.native_unsupported_memory',
      );
      expect(within(note).queryByText('settings.assistant.on_device_mobile_disabled')).not.toBeInTheDocument();
    });

    it('falls back to the generic note when the probe failed without a reason', async () => {
      isNative = true;
      nativeSupported = false;
      nativeUnsupportedReason = undefined;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const note = await screen.findByTestId('assistant-on-device-unavailable');
      expect(within(note).getByText('settings.assistant.on_device_mobile_disabled')).toHaveTextContent(
        'settings.assistant.on_device_mobile_disabled',
      );
    });

    it('shows an Ollama/native backend picker once the device passes isSupported(), defaulting to Ollama', async () => {
      isNative = true;
      nativeSupported = true;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      expect(screen.queryByTestId('assistant-on-device-unavailable')).not.toBeInTheDocument();
      expect(within(select).getByText('settings.assistant.backend_ollama')).toHaveTextContent(
        'settings.assistant.backend_ollama',
      );
      expect(within(select).getByText('settings.assistant.backend_download_model')).toHaveTextContent(
        'settings.assistant.backend_download_model',
      );
      expect(within(select).queryByText('settings.assistant.backend_on_device')).not.toBeInTheDocument();
      expect(screen.getByTestId('assistant-ollama-url')).toHaveValue('http://localhost:11434/v1');
    });

    it('switches to the native download/delete section when native is selected', async () => {
      isNative = true;
      nativeSupported = true;
      const update = vi.fn();
      const { rerender } = render(
        <AssistantSection settings={enabledSettings} update={update} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      fireEvent.change(select, { target: { value: 'native' } });
      expect(update).toHaveBeenCalledWith('assistantBackend', 'native');

      rerender(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'native' }}
          update={update}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      expect(screen.queryByTestId('assistant-ollama-url')).not.toBeInTheDocument();
      expect(await screen.findByTestId('assistant-native-model-download')).toHaveTextContent(
        'settings.assistant.download',
      );
      expect(screen.getByTestId('assistant-native-model-delete')).toHaveTextContent('settings.assistant.delete');
    });
  });

  // Task (refs #270): the OS-hosted Apple Foundation Models backend appears in
  // the picker on its own probe, independent of the native (llama.cpp) gate.
  describe('Apple Intelligence backend on a phone or tablet', () => {
    it('offers the Apple Intelligence option in the picker when the probe passes, even without native support', async () => {
      isNative = true;
      appleSupported = true; // nativeSupported stays false
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      expect(screen.queryByTestId('assistant-on-device-unavailable')).not.toBeInTheDocument();
      expect(within(select).getByText('settings.assistant.backend_apple')).toHaveTextContent(
        'settings.assistant.backend_apple',
      );
      expect(within(select).getByText('settings.assistant.backend_ollama')).toHaveTextContent(
        'settings.assistant.backend_ollama',
      );
      expect(within(select).queryByText('settings.assistant.backend_download_model')).not.toBeInTheDocument();
    });

    // Order is the user-facing one: your own server, then the OS-supplied
    // models, then the one that costs a download. `native` is last because it
    // is presented as "Download model", not as an engine.
    it('lists ollama, then the OS model, then the downloaded model', async () => {
      isNative = true;
      appleSupported = true;
      nativeSupported = true;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      const values = within(select)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value);
      expect(values).toEqual(['ollama', 'apple', 'native']);
    });

    // The requested four-label scheme in one assertion: Android reaches only
    // two of them, because llama.cpp was removed from that build (issue #270)
    // and WebLLM is gated off on mobile, so there is nothing to download.
    it('offers Ollama and AICore only on Android, with no download option', async () => {
      isNative = true;
      isAndroid = true;
      geminiSupported = true;
      nativeSupported = false;
      appleSupported = false;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      const values = within(select)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value);
      expect(values).toEqual(['ollama', 'gemini-nano']);
    });

    it('shows the backend accuracy hint under the picker', async () => {
      isNative = true;
      isIOS = true; // the hint is per-platform; this is the three-backend ranking
      appleSupported = true;
      nativeSupported = true;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const hint = await screen.findByTestId('assistant-backend-accuracy-hint');
      // Per-platform now: iOS ranks three backends, Android two (issue #270).
      expect(hint).toHaveTextContent('settings.assistant.backend_accuracy_hint_ios');
    });

    it('omits the Apple Intelligence option when the probe does not report support', async () => {
      isNative = true;
      nativeSupported = true; // picker is present, but apple is not offered
      appleSupported = false;
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      expect(within(select).queryByText('settings.assistant.backend_apple')).not.toBeInTheDocument();
    });

    it('renders no download/delete surface when the apple backend is selected', async () => {
      isNative = true;
      appleSupported = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'apple' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      await screen.findByTestId('assistant-backend-select');
      expect(screen.queryByTestId('assistant-ollama-url')).not.toBeInTheDocument();
      expect(screen.queryByTestId('assistant-native-model-download')).not.toBeInTheDocument();
      expect(screen.queryByTestId('assistant-model-select')).not.toBeInTheDocument();
    });

    // Task 2 (refs #270): the developer on-device eval row is the ONLY control
    // under the apple backend, and only when that supported backend is selected.
    it('shows the on-device eval run button when the apple backend is selected and supported', async () => {
      isNative = true;
      appleSupported = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'apple' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      expect(await screen.findByTestId('system-model-eval-run')).toHaveTextContent(
        'settings.assistant.system_model_eval_run',
      );
    });

    it('does not show the eval row for a non-apple backend even when apple is supported', async () => {
      isNative = true;
      appleSupported = true;
      nativeSupported = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'ollama' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      await screen.findByTestId('assistant-backend-select');
      expect(screen.queryByTestId('system-model-eval-run')).not.toBeInTheDocument();
    });

    // The Android system model (refs #270). Gated on its own probe, so it can be
    // the only on-device backend a phone offers.
    it('offers the Gemini Nano option when only its probe reports supported', async () => {
      isNative = true;
      isAndroid = true;
      geminiSupported = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      expect(select.querySelector('option[value="gemini-nano"]')).toHaveTextContent(
        'settings.assistant.backend_gemini_nano',
      );
    });

    it('shows the eval row, and no Ollama settings, when the Gemini Nano backend is selected', async () => {
      isNative = true;
      isAndroid = true;
      geminiSupported = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'gemini-nano' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      expect(await screen.findByTestId('system-model-eval-run')).toHaveTextContent(
        'settings.assistant.system_model_eval_run',
      );
      // The branch exists so the Platform.isNative fallback cannot render the
      // remote-server settings underneath an on-device backend.
      expect(screen.queryByTestId('assistant-ollama-url')).not.toBeInTheDocument();
    });

    it('offers the download instead of the option while Gemini Nano is not downloaded', async () => {
      isNative = true;
      isAndroid = true;
      geminiSupported = false;
      geminiUnsupportedReason = 'notReady';
      nativeSupported = true; // so the picker renders at all
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      const select = await screen.findByTestId('assistant-backend-select');
      expect(select.querySelector('option[value="gemini-nano"]')).toBeNull();
      expect(screen.getByTestId('assistant-gemini-nano-download-button')).toHaveTextContent(
        'settings.assistant.download',
      );
    });

    it('shows no download row when Gemini Nano is unsupported outright', async () => {
      isNative = true;
      isAndroid = true;
      geminiSupported = false;
      geminiUnsupportedReason = 'platform';
      nativeSupported = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />,
      );

      await screen.findByTestId('assistant-backend-select');
      expect(screen.queryByTestId('assistant-gemini-nano-download-button')).not.toBeInTheDocument();
    });

    it('shows the enable-Apple-Intelligence hint when the probe reports reason "disabled"', async () => {
      isNative = true;
      appleSupported = false;
      appleUnsupportedReason = 'disabled';
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      const hint = await screen.findByTestId('assistant-apple-disabled');
      expect(within(hint).getByText('settings.assistant.apple_disabled_hint')).toHaveTextContent(
        'settings.assistant.apple_disabled_hint',
      );
    });

    it('shows no apple hint for reasons other than "disabled"', async () => {
      isNative = true;
      appleSupported = false;
      appleUnsupportedReason = 'notReady';
      render(
        <AssistantSection settings={enabledSettings} update={vi.fn()} currentProfile={profile} updateSettings={vi.fn()} />,
      );

      await screen.findByTestId('assistant-on-device-unavailable');
      expect(screen.queryByTestId('assistant-apple-disabled')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('assistant-model-select')).toHaveValue(DEFAULT_SETTINGS.assistantModelId);
    expect(screen.queryByTestId('assistant-ollama-url')).not.toBeInTheDocument();
    expect(screen.getByText('settings.assistant.on_device_ollama_hint')).toHaveTextContent(
      'settings.assistant.on_device_ollama_hint',
    );
  });

  it('shows the backend accuracy hint under the desktop picker', async () => {
    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );
    await waitFor(() => expect(isModelDownloadedMock).toHaveBeenCalled());

    expect(screen.getByTestId('assistant-backend-accuracy-hint')).toHaveTextContent(
      'settings.assistant.backend_accuracy_hint_web',
    );
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

    expect(screen.getByTestId('assistant-ollama-url')).toHaveValue('http://localhost:11434/v1');
    expect(screen.getByTestId('assistant-ollama-model')).toHaveAttribute(
      'placeholder',
      'settings.assistant.ollama_model_placeholder',
    );
    expect(screen.getByTestId('assistant-ollama-key')).toHaveAttribute(
      'placeholder',
      'settings.assistant.ollama_key_placeholder',
    );
    expect(screen.getByTestId('assistant-ollama-test')).toHaveTextContent('settings.assistant.ollama_test');
    expect(screen.queryByTestId('assistant-model-select')).not.toBeInTheDocument();

    // Lets AssistantOllamaSection's mount-effect model fetch (refs #246 Fix
    // 2) settle inside `act` instead of leaking a state update past the end
    // of the test.
    await waitFor(() => expect(screen.getByTestId('assistant-ollama-model')).toHaveValue(''));
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

    const logo = container.querySelector(`img[src="${NINJII_LOGO_URL}"]`);
    expect(logo).toHaveAttribute('src', NINJII_LOGO_URL);
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
    await waitFor(() =>
      expect(screen.getByTestId('assistant-no-webgpu')).toHaveTextContent('settings.assistant.no_webgpu_hint'),
    );
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
