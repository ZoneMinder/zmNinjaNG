/**
 * AssistantNativeSection download/delete/storage wiring (refs #270)
 *
 * Mocks `lib/assistant/native-model-download` so these tests exercise only
 * the button enable/disable state machine and the storage row, never a real
 * Capacitor plugin. `downloading` is derived from the real `useBackgroundTasks`
 * store (not a local flag), so these tests drive that store's actions
 * directly, mirroring `AssistantSection-download.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { AssistantNativeSection } from '../AssistantNativeSection';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';

const MODEL_ID = ASSISTANT.nativeLlmModel.id;

const isNativeModelDownloadedMock = vi.fn();
const downloadNativeModelMock = vi.fn();
const deleteNativeModelMock = vi.fn();

vi.mock('../../../lib/assistant/native-model-download', () => ({
  isNativeModelDownloaded: () => isNativeModelDownloadedMock(),
  downloadNativeModel: () => downloadNativeModelMock(),
  deleteNativeModel: () => deleteNativeModelMock(),
}));

// Records every call so the storage row's interpolated args (path, formatted
// size) can be asserted directly instead of guessing at a rendered string
// this mock doesn't interpolate (same pattern as AssistantSection-storage.test.tsx).
const tMock = vi.fn((k: string, d?: Record<string, unknown> | string) => (typeof d === 'string' ? d : k));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}));

const toastMock = vi.fn();
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

/** Adds a download task for the native model in the real backgroundTasks
 *  store and moves it straight to 'in_progress', mirroring the first
 *  `updateProgress` call `downloadNativeModel` makes once the plugin's
 *  `downloadProgress` listener fires. */
function seedInProgressTask(): string {
  const taskId = useBackgroundTasks.getState().addTask({
    type: 'download',
    metadata: { title: MODEL_ID, modelId: MODEL_ID },
  });
  useBackgroundTasks.getState().updateProgress(taskId, 10);
  return taskId;
}

describe('AssistantNativeSection', () => {
  beforeEach(() => {
    isNativeModelDownloadedMock.mockReset();
    downloadNativeModelMock.mockReset();
    deleteNativeModelMock.mockReset();
    toastMock.mockReset();
    tMock.mockClear();
    useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
  });

  it('shows Download enabled and Delete disabled when the model is not downloaded', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: false });

    render(<AssistantNativeSection />);

    await waitFor(() => expect(screen.getByTestId('assistant-native-model-download')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-native-model-delete')).toBeDisabled();
  });

  it('shows Delete enabled and Download disabled, plus the storage row, when the model is downloaded', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({
      downloaded: true,
      sizeBytes: 2_500_000_000,
      path: '/data/models/qwen.gguf',
    });

    render(<AssistantNativeSection />);

    await waitFor(() => expect(screen.getByTestId('assistant-native-model-delete')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-native-model-download')).toBeDisabled();

    await screen.findByTestId('assistant-native-model-storage');
    expect(tMock).toHaveBeenCalledWith('settings.assistant.storage_path', { path: '/data/models/qwen.gguf' });
    expect(tMock).toHaveBeenCalledWith('settings.assistant.storage_used', { size: '2.3 GB' });
  });

  it('does not render the storage row while not downloaded', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: false });

    render(<AssistantNativeSection />);

    await waitFor(() => expect(screen.getByTestId('assistant-native-model-download')).not.toBeDisabled());
    expect(screen.queryByTestId('assistant-native-model-storage')).not.toBeInTheDocument();
  });

  it('calls deleteNativeModel on click and clears downloaded state', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: true, sizeBytes: 100, path: '/x' });
    deleteNativeModelMock.mockResolvedValue(undefined);

    render(<AssistantNativeSection />);

    const deleteButton = await screen.findByTestId('assistant-native-model-delete');
    await waitFor(() => expect(deleteButton).not.toBeDisabled());

    fireEvent.click(deleteButton);

    expect(deleteNativeModelMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('assistant-native-model-download')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-native-model-delete')).toBeDisabled();
  });

  it('surfaces an error toast when delete fails', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: true });
    deleteNativeModelMock.mockRejectedValue(new Error('fs error'));

    render(<AssistantNativeSection />);

    const deleteButton = await screen.findByTestId('assistant-native-model-delete');
    await waitFor(() => expect(deleteButton).not.toBeDisabled());

    fireEvent.click(deleteButton);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
  });

  it('shows the downloading label and disables the button for an in-progress task', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: false });
    seedInProgressTask();

    render(<AssistantNativeSection />);

    const downloadButton = await screen.findByTestId('assistant-native-model-download');
    await waitFor(() => expect(downloadButton).toBeDisabled());
    expect(downloadButton).toHaveTextContent('settings.assistant.downloading');
  });

  it('calls downloadNativeModel on click and flips to downloaded when the task completes', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: false });
    let taskId = '';
    downloadNativeModelMock.mockImplementation(() => {
      taskId = useBackgroundTasks.getState().addTask({
        type: 'download',
        metadata: { title: MODEL_ID, modelId: MODEL_ID },
      });
      useBackgroundTasks.getState().updateProgress(taskId, 10);
      return Promise.resolve();
    });

    render(<AssistantNativeSection />);

    const downloadButton = await screen.findByTestId('assistant-native-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());

    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: true, sizeBytes: 100, path: '/x' });
    fireEvent.click(downloadButton);

    expect(downloadNativeModelMock).toHaveBeenCalled();
    await waitFor(() => expect(downloadButton).toBeDisabled());

    await act(async () => {
      useBackgroundTasks.getState().completeTask(taskId);
    });

    await waitFor(() => expect(screen.getByTestId('assistant-native-model-delete')).not.toBeDisabled());
    expect(screen.getByTestId('assistant-native-model-download')).toBeDisabled();
    expect(screen.getByTestId('assistant-native-model-downloaded-status')).toBeInTheDocument();
  });

  it('surfaces an error toast and returns to not-downloaded when the task fails', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: false });
    const taskId = seedInProgressTask();

    render(<AssistantNativeSection />);

    await waitFor(() => expect(screen.getByTestId('assistant-native-model-download')).toBeDisabled());

    await act(async () => {
      useBackgroundTasks.getState().failTask(taskId, new Error('download failed'));
    });

    await waitFor(() => expect(screen.getByTestId('assistant-native-model-download')).not.toBeDisabled());
    expect(toastMock).toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
  });

  it('does not treat a task for a different model as downloading', async () => {
    isNativeModelDownloadedMock.mockResolvedValue({ downloaded: false });
    useBackgroundTasks.getState().addTask({
      type: 'download',
      metadata: { title: 'other', modelId: 'some-other-model' },
    });

    render(<AssistantNativeSection />);

    const downloadButton = await screen.findByTestId('assistant-native-model-download');
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    expect(downloadButton).toHaveTextContent('settings.assistant.download');
  });
});
