/**
 * AssistantSection storage-info display (refs #246)
 *
 * Mocks `lib/assistant/model-download` and `lib/assistant/model-storage` so
 * these tests exercise only the storage-info block `AssistantSection.tsx`
 * renders once the selected model is downloaded, never real WebGPU, WebLLM,
 * or browser storage APIs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AssistantSection } from '../AssistantSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';

const isModelDownloadedMock = vi.fn();
const downloadModelMock = vi.fn();
const deleteModelMock = vi.fn();
const getModelStorageInfoMock = vi.fn();

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: (modelId: string) => downloadModelMock(modelId),
  deleteModel: (modelId: string) => deleteModelMock(modelId),
}));

vi.mock('../../../lib/assistant/model-storage', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/assistant/model-storage')>(
    '../../../lib/assistant/model-storage'
  );
  return {
    ...actual,
    getModelStorageInfo: () => getModelStorageInfoMock(),
  };
});

vi.mock('../../../hooks/useWebGpuAvailable', () => ({
  useWebGpuAvailable: () => true,
}));

// Returns the key for keys with no interpolation args (enough to assert a
// given line rendered at all) and records every call so tests with
// interpolation args (path, formatted size) can assert on the real args
// passed to `t` instead of guessing at an interpolated template string this
// mock doesn't have.
const tMock = vi.fn((k: string, d?: Record<string, unknown> | string) => (typeof d === 'string' ? d : k));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}));

const toastMock = vi.fn();
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe('AssistantSection storage info', () => {
  const profile = { id: 'p1' } as never;
  const enabledSettings = { ...DEFAULT_SETTINGS, assistantEnabled: true };

  beforeEach(() => {
    isModelDownloadedMock.mockReset();
    downloadModelMock.mockReset();
    deleteModelMock.mockReset();
    getModelStorageInfoMock.mockReset();
    toastMock.mockReset();
    tMock.mockClear();
  });

  it('does not render the storage block while the model is not downloaded', async () => {
    isModelDownloadedMock.mockResolvedValue(false);

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByTestId('assistant-model-download')).not.toBeDisabled());
    expect(screen.queryByTestId('assistant-model-storage')).not.toBeInTheDocument();
    expect(getModelStorageInfoMock).not.toHaveBeenCalled();
  });

  it('renders backend and usage once the model is downloaded (no OS path: web/browser)', async () => {
    isModelDownloadedMock.mockResolvedValue(true);
    getModelStorageInfoMock.mockResolvedValue({
      backend: 'cache',
      usageBytes: 500 * 1024 * 1024,
      persisted: true,
    });

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const block = await screen.findByTestId('assistant-model-storage');
    expect(block).toHaveTextContent('settings.assistant.storage_browser_cache');
    expect(block).toHaveTextContent('settings.assistant.storage_persistent_yes');
    expect(tMock).toHaveBeenCalledWith('settings.assistant.storage_used', { size: '500.0 MB' });
  });

  it('renders the OS path when electronPaths surfaced one (Electron desktop)', async () => {
    isModelDownloadedMock.mockResolvedValue(true);
    getModelStorageInfoMock.mockResolvedValue({
      backend: 'cache',
      osPath: '/Users/test/Library/Application Support/zmNinjaNg',
    });

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    await screen.findByTestId('assistant-model-storage');
    expect(tMock).toHaveBeenCalledWith('settings.assistant.storage_path', {
      path: '/Users/test/Library/Application Support/zmNinjaNg',
    });
  });
});
