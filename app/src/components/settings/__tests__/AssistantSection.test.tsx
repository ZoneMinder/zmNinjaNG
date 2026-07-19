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
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantSection } from '../AssistantSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';

const isModelDownloadedMock = vi.fn().mockResolvedValue(false);
const isNativeMnnModelDownloadedMock = vi.fn().mockResolvedValue(false);
const downloadNativeMnnModelMock = vi.fn().mockResolvedValue(undefined);
const cancelNativeMnnDownloadMock = vi.fn().mockResolvedValue(undefined);
const getNativeMnnModelSizeMock = vi.fn().mockResolvedValue(0);
const { useCapacitorListenerMock } = vi.hoisted(() => ({ useCapacitorListenerMock: vi.fn() }));

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: vi.fn(),
  deleteModel: vi.fn(),
}));

vi.mock('../../../lib/assistant/native-mnn', () => ({
  isNativeMnnModelDownloaded: (modelId: string) => isNativeMnnModelDownloadedMock(modelId),
  downloadNativeMnnModel: (modelId: string) => downloadNativeMnnModelMock(modelId),
  cancelNativeMnnDownload: () => cancelNativeMnnDownloadMock(),
  getNativeMnnModelSize: (modelId: string) => getNativeMnnModelSizeMock(modelId),
  deleteNativeMnnModel: vi.fn(),
  getNativeMnnListenerSource: vi.fn(),
  NATIVE_MNN_MODELS: [{ id: 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN', label: 'Qwen3.5 2B Reasoning', approxSizeMb: 1383, contextWindowSize: 4096 }],
  supportsNativeMnnModel: (modelId: string) => modelId === 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN',
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
    isNativeMnnModelDownloadedMock.mockReset().mockResolvedValue(false);
    downloadNativeMnnModelMock.mockReset().mockResolvedValue(undefined);
    cancelNativeMnnDownloadMock.mockReset().mockResolvedValue(undefined);
    getNativeMnnModelSizeMock.mockReset().mockResolvedValue(0);
    useCapacitorListenerMock.mockReset();
    webGpuAvailable = true;
    isIOS = false;
    isAndroid = false;
    isNative = false;
  });

  describe('native MNN', () => {
    it('downloads fallback Qwen model when profile has a desktop-only model', async () => {
      isIOS = true;
      isNative = true;
      const updateSettings = vi.fn();
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantModelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={updateSettings}
        />
      );

      await waitFor(() => expect(isNativeMnnModelDownloadedMock).toHaveBeenCalledWith('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN'));
      expect(updateSettings).toHaveBeenCalledWith('p1', { assistantModelId: 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN' });
      await waitFor(() => expect(screen.getByTestId('assistant-model-download')).toBeEnabled());

      fireEvent.click(screen.getByTestId('assistant-model-download'));
      expect(downloadNativeMnnModelMock).toHaveBeenCalledWith('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN');
    });

    it('shows Android on-device picker with only native MNN models', async () => {
      isAndroid = true;
      isNative = true;
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
      expect(onDeviceOption).not.toBeDisabled();
      expect(screen.getByTestId('assistant-model-select')).toHaveTextContent('Qwen3.5 2B Reasoning');
      expect(screen.queryByTestId('assistant-no-webgpu')).not.toBeInTheDocument();
    });

    it('shows iOS on-device picker with native MNN models', async () => {
      isIOS = true;
      isNative = true;
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
      expect(onDeviceOption).not.toBeDisabled();
      expect(screen.getByTestId('assistant-model-select')).toHaveTextContent('Qwen3.5 2B Reasoning');
      expect(screen.queryByTestId('assistant-no-webgpu')).not.toBeInTheDocument();
    });

    it('shows native MNN download UI on iOS, even with WebGPU present', () => {
      isIOS = true;
      isNative = true;
      webGpuAvailable = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      expect(screen.getByTestId('assistant-model-select')).toBeInTheDocument();
      expect(screen.getByTestId('assistant-model-download')).toBeInTheDocument();
    });

    it('cancels an in-flight native download and clears the progress UI', async () => {
      isIOS = true;
      isNative = true;
      // Never settles on its own, so the download stays in flight until cancel
      // rejects it, matching what the plugin does.
      let rejectDownload: (error: Error) => void = () => {};
      downloadNativeMnnModelMock.mockReturnValue(new Promise((_, reject) => { rejectDownload = reject; }));
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      await waitFor(() => expect(screen.getByTestId('assistant-model-download')).toBeEnabled());
      fireEvent.click(screen.getByTestId('assistant-model-download'));

      const cancel = await screen.findByTestId('assistant-native-download-cancel');
      fireEvent.click(cancel);
      expect(cancelNativeMnnDownloadMock).toHaveBeenCalled();

      await act(async () => {
        rejectDownload(new Error('Native MNN download cancelled'));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.queryByTestId('assistant-native-download-cancel')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByTestId('assistant-model-download')).toBeEnabled());
    });

    it('shows on-disk model size on native once downloaded', async () => {
      isAndroid = true;
      isNative = true;
      isNativeMnnModelDownloadedMock.mockResolvedValue(true);
      getNativeMnnModelSizeMock.mockResolvedValue(1_450_000_000);
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );

      const storage = await screen.findByTestId('assistant-model-storage');
      expect(getNativeMnnModelSizeMock).toHaveBeenCalledWith('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN');
      expect(storage).toHaveTextContent('1.4 GB');
    });

    it('shows active native file progress with completed and pending counts', async () => {
      isIOS = true;
      isNative = true;
      render(
        <AssistantSection
          settings={enabledSettings}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      await waitFor(() => expect(screen.getByTestId('assistant-model-download')).toBeEnabled());
      fireEvent.click(screen.getByTestId('assistant-model-download'));

      const listener = useCapacitorListenerMock.mock.calls.find((call) => call[1] === 'downloadProgress')?.[2] as
        | ((progress: Record<string, unknown>) => void)
        | undefined;
      expect(listener).toBeDefined();
      act(() => listener?.({
        modelId: 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN', fileName: 'llm.mnn.weight', fileIndex: 2, fileCount: 8,
        fileProgress: 25, fileBytesWritten: 256 * 1024 * 1024, fileBytesTotal: 1024 * 1024 * 1024,
      }));

      expect(screen.getByTestId('assistant-native-download-details')).toHaveTextContent('llm.mnn.weight');
      expect(screen.getByTestId('assistant-native-download-details')).toHaveTextContent('1:7');
    });

    it('switches iOS native MNN picker to Ollama', () => {
      isIOS = true;
      isNative = true;
      render(
        <AssistantSection
          settings={{ ...enabledSettings, assistantBackend: 'ollama' }}
          update={vi.fn()}
          currentProfile={profile}
          updateSettings={vi.fn()}
        />
      );
      expect(screen.getByTestId('assistant-ollama-url')).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-model-select')).not.toBeInTheDocument();
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
      expect(screen.queryByTestId('assistant-no-webgpu')).not.toBeInTheDocument();
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
