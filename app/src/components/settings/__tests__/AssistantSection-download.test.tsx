/**
 * AssistantSection download/delete wiring (refs #246, Task 16)
 *
 * Mocks `lib/assistant/model-download` and `useWebGpuAvailable` so these
 * tests exercise only the button enable/disable state machine in
 * `AssistantSection.tsx`, never real WebGPU or WebLLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { AssistantSection } from '../AssistantSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';

const MODEL_A = ASSISTANT.webllmModels[0].id;
const MODEL_B = ASSISTANT.webllmModels[1].id;

const isModelDownloadedMock = vi.fn();
const downloadModelMock = vi.fn();
const deleteModelMock = vi.fn();

vi.mock('../../../lib/assistant/model-download', () => ({
  isModelDownloaded: (modelId: string) => isModelDownloadedMock(modelId),
  downloadModel: (modelId: string) => downloadModelMock(modelId),
  deleteModel: (modelId: string) => deleteModelMock(modelId),
}));

vi.mock('../../../hooks/useWebGpuAvailable', () => ({
  useWebGpuAvailable: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: Record<string, unknown> | string) => (typeof d === 'string' ? d : k) }),
}));

const toastMock = vi.fn();
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe('AssistantSection download/delete', () => {
  const profile = { id: 'p1' } as never;
  const enabledSettings = { ...DEFAULT_SETTINGS, assistantEnabled: true };

  beforeEach(() => {
    isModelDownloadedMock.mockReset();
    downloadModelMock.mockReset();
    deleteModelMock.mockReset();
    toastMock.mockReset();
  });

  it('shows Download enabled and Delete disabled when the model is not downloaded', async () => {
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
    expect(screen.getByTestId('assistant-model-delete')).toBeDisabled();
  });

  it('calls downloadModel on click and disables the button while downloading', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    let resolveDownload: () => void = () => {};
    downloadModelMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        })
    );

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const downloadButton = await screen.findByTestId('assistant-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());

    // After the click, downloadModel resolves the cache check below to
    // "downloaded", so isModelDownloaded's second call (post-download) must
    // return true.
    isModelDownloadedMock.mockResolvedValue(true);
    fireEvent.click(downloadButton);

    expect(downloadModelMock).toHaveBeenCalledWith(DEFAULT_SETTINGS.assistantModelId);
    await waitFor(() => expect(downloadButton).toBeDisabled());

    await act(async () => {
      resolveDownload();
    });

    await waitFor(() => expect(screen.getByTestId('assistant-model-delete')).not.toBeDisabled());
  });

  it('shows Delete enabled and Download disabled when the model is downloaded', async () => {
    isModelDownloadedMock.mockResolvedValue(true);

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByTestId('assistant-model-delete')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-model-download')).toBeDisabled();
  });

  it('calls deleteModel on click and clears downloaded state', async () => {
    isModelDownloadedMock.mockResolvedValue(true);
    deleteModelMock.mockResolvedValue(undefined);

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const deleteButton = await screen.findByTestId('assistant-model-delete');
    await waitFor(() => expect(deleteButton).not.toBeDisabled());

    fireEvent.click(deleteButton);

    expect(deleteModelMock).toHaveBeenCalledWith(DEFAULT_SETTINGS.assistantModelId);
    await waitFor(() => expect(screen.getByTestId('assistant-model-download')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-model-delete')).toBeDisabled();
  });

  it('surfaces an error toast when downloadModel fails to leave the model cached', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    downloadModelMock.mockResolvedValue(undefined); // resolves without caching (internal failure)

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const downloadButton = await screen.findByTestId('assistant-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());

    fireEvent.click(downloadButton);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
  });

  it('disables the model select while a download is in flight', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    let resolveDownload: () => void = () => {};
    downloadModelMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        })
    );

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const downloadButton = await screen.findByTestId('assistant-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    expect(screen.getByTestId('assistant-model-select')).not.toBeDisabled();

    fireEvent.click(downloadButton);
    await waitFor(() => expect(screen.getByTestId('assistant-model-select')).toBeDisabled());

    await act(async () => {
      resolveDownload();
    });

    await waitFor(() => expect(screen.getByTestId('assistant-model-select')).not.toBeDisabled());
  });

  it('does not let a download resolving for model A overwrite the status displayed after switching to model B', async () => {
    // Call 1: mount check for model A -> not downloaded.
    // Call 2: switch to model B -> B is already downloaded.
    // Call 3: A's downloadModel finally resolves, so handleDownload's
    // post-await re-check for A runs, but by then B is selected; the
    // component must not let it overwrite B's "downloaded" status.
    isModelDownloadedMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    let resolveDownload: () => void = () => {};
    downloadModelMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        })
    );

    const { rerender } = render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const downloadButton = await screen.findByTestId('assistant-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());

    // Start the download for model A (the default selected model).
    fireEvent.click(downloadButton);
    expect(downloadModelMock).toHaveBeenCalledWith(MODEL_A);

    // User switches the selected model to B while A's download is still
    // in flight (e.g. a profile-level settings push landing mid-download).
    rerender(
      <AssistantSection
        settings={{ ...enabledSettings, assistantModelId: MODEL_B }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    // B is already downloaded. Both buttons stay disabled while A's download
    // is still in flight (the global downloading flag), but the "Downloaded"
    // status label is driven only by `downloadStatus`, so it already reflects
    // B's real state here.
    await waitFor(() => expect(screen.getByTestId('assistant-model-downloaded-status')).toBeInTheDocument());

    // Now let A's stale download resolve.
    await act(async () => {
      resolveDownload();
    });

    // B's displayed status must be unaffected by A's stale resolution: still
    // downloaded, Delete enabled, Download disabled, no error toast.
    await waitFor(() => expect(screen.getByTestId('assistant-model-delete')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-model-download')).toBeDisabled();
    expect(screen.getByTestId('assistant-model-downloaded-status')).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
