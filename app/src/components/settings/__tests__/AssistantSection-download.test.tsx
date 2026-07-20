/**
 * AssistantSection download/delete wiring (refs #246, Task 16)
 *
 * Mocks `lib/assistant/model-download` and `useWebGpuAvailable` so these
 * tests exercise only the button enable/disable state machine in
 * `AssistantSection.tsx`, never real WebGPU or WebLLM.
 *
 * `downloading` is derived from the real `useBackgroundTasks` store (not a
 * local flag), so these tests drive that store's actions directly
 * (`addTask`/`updateProgress`/`completeTask`/`failTask`) the same way the
 * real `downloadModel` does, instead of resolving/rejecting a mocked
 * `downloadModel` promise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { AssistantSection } from '../AssistantSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';

// MODEL_A must be the model the section starts on (DEFAULT_SETTINGS'
// assistantModelId), not webllmModels[0]: the default is not required to be
// first in the picker, and tying these to list order silently retargeted every
// assertion at an unselected model when the list was reordered.
const MODEL_A = ASSISTANT.defaultModelId;
// A second id that is deliberately NOT read from `webllmModels`, which now
// lists one supported model. Both MODEL_B cases below are about state
// belonging to some OTHER model (a stale background task, a settings push
// carrying an id this build no longer lists) leaking into the selected
// model's status, and a retired id is exactly what turns up there.
const MODEL_B = 'Qwen3-1.7B-q4f16_1-MLC';

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

/** Adds a download task for `modelId` in the real backgroundTasks store and
 *  moves it straight to 'in_progress', mirroring the first `updateProgress`
 *  call the real `downloadModel` makes once `CreateMLCEngine`'s progress
 *  callback fires. */
function seedInProgressTask(modelId: string): string {
  const taskId = useBackgroundTasks.getState().addTask({
    type: 'download',
    metadata: { title: modelId, modelId },
  });
  useBackgroundTasks.getState().updateProgress(taskId, 10);
  return taskId;
}

describe('AssistantSection download/delete', () => {
  const profile = { id: 'p1' } as never;
  const enabledSettings = { ...DEFAULT_SETTINGS, assistantEnabled: true };

  beforeEach(() => {
    isModelDownloadedMock.mockReset();
    downloadModelMock.mockReset();
    deleteModelMock.mockReset();
    toastMock.mockReset();
    useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
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

  it('shows the downloading label and disables the button and select for an in-progress task matching the selected model', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    seedInProgressTask(MODEL_A);

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const downloadButton = await screen.findByTestId('assistant-model-download');
    await waitFor(() => expect(downloadButton).toBeDisabled());
    expect(downloadButton).toHaveTextContent('settings.assistant.downloading');
    expect(screen.getByTestId('assistant-model-select')).toBeDisabled();
  });

  it('does not treat a task for a different model as downloading', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    seedInProgressTask(MODEL_B);

    render(
      <AssistantSection
        settings={enabledSettings} // assistantModelId defaults to MODEL_A
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    const downloadButton = await screen.findByTestId('assistant-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    expect(downloadButton).toHaveTextContent('settings.assistant.download');
    expect(screen.getByTestId('assistant-model-select')).not.toBeDisabled();
  });

  it('calls downloadModel on click, disables the button while in progress, and flips to downloaded when the task completes (no click-handler promise involved)', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    let taskId = '';
    downloadModelMock.mockImplementation((modelId: string) => {
      taskId = useBackgroundTasks.getState().addTask({
        type: 'download',
        metadata: { title: modelId, modelId },
      });
      useBackgroundTasks.getState().updateProgress(taskId, 10);
      // Mirrors the real `downloadModel`: it reports into the store and
      // resolves once the task is created, well before the download itself
      // (here simulated by a later `completeTask` call) finishes.
      return Promise.resolve();
    });

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

    isModelDownloadedMock.mockResolvedValue(true);
    fireEvent.click(downloadButton);

    expect(downloadModelMock).toHaveBeenCalledWith(MODEL_A);
    await waitFor(() => expect(downloadButton).toBeDisabled());
    expect(downloadButton).toHaveTextContent('settings.assistant.downloading');

    // The task completes on its own (not via any promise this component's
    // click handler is awaiting): the UI must still pick it up.
    await act(async () => {
      useBackgroundTasks.getState().completeTask(taskId);
    });

    await waitFor(() => expect(screen.getByTestId('assistant-model-delete')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-model-download')).toBeDisabled();
    expect(screen.getByTestId('assistant-model-downloaded-status')).toBeInTheDocument();
  });

  it('surfaces an error toast and returns to not-downloaded when the task fails', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    const taskId = seedInProgressTask(MODEL_A);

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByTestId('assistant-model-download')).toBeDisabled());

    await act(async () => {
      useBackgroundTasks.getState().failTask(taskId, new Error('download failed'));
    });

    await waitFor(() => expect(screen.getByTestId('assistant-model-download')).not.toBeDisabled());
    expect(toastMock).toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
  });

  it('surfaces an error toast when a completed task re-check finds the model not actually cached', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    const taskId = seedInProgressTask(MODEL_A);

    render(
      <AssistantSection
        settings={enabledSettings}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByTestId('assistant-model-download')).toBeDisabled());

    await act(async () => {
      useBackgroundTasks.getState().completeTask(taskId);
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
    await waitFor(() => expect(screen.getByTestId('assistant-model-download')).not.toBeDisabled());
  });

  it('disables the model select while a download is in flight', async () => {
    isModelDownloadedMock.mockResolvedValue(false);
    let taskId = '';
    downloadModelMock.mockImplementation((modelId: string) => {
      taskId = useBackgroundTasks.getState().addTask({
        type: 'download',
        metadata: { title: modelId, modelId },
      });
      useBackgroundTasks.getState().updateProgress(taskId, 10);
      return Promise.resolve();
    });

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
      useBackgroundTasks.getState().completeTask(taskId);
    });

    await waitFor(() => expect(screen.getByTestId('assistant-model-select')).not.toBeDisabled());
  });

  // Replaces a test that switched between two listed models mid-download.
  // `webllmModels` lists one supported model now, so that switch is not
  // reachable; what IS reachable is a persisted profile still holding one of
  // the retired ids, which is what this asserts the section survives.
  it('falls back to the supported model when settings carry a retired model id', async () => {
    isModelDownloadedMock.mockResolvedValue(true);

    render(
      <AssistantSection
        settings={{ ...enabledSettings, assistantModelId: MODEL_B }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );

    // The retired id resolves to the one supported model rather than leaving
    // the picker blank or the status unknown (AssistantSection.tsx:82).
    await waitFor(() => expect(screen.getByTestId('assistant-model-downloaded-status')).toBeInTheDocument());
    expect(isModelDownloadedMock).toHaveBeenCalledWith(MODEL_A);
    expect(screen.getByTestId('assistant-model-select')).toHaveValue(MODEL_A);
  });
});
