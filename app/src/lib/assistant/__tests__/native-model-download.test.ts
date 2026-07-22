/**
 * native-model-download.ts tests (refs #270)
 *
 * `plugins/native-llm` is mocked globally in tests/setup.ts; this file
 * overrides individual methods per test to exercise specific lifecycle paths
 * (progress, completion, failure, cancel) without a real Capacitor bridge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeLlm } from '../../../plugins/native-llm';
import {
  downloadNativeModel,
  deleteNativeModel,
  isNativeModelDownloaded,
  NATIVE_MODEL_NOT_AVAILABLE_MESSAGE,
} from '../native-model-download';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';
import { ASSISTANT } from '../../zmninja-ng-constants';

const MODEL_ID = ASSISTANT.nativeLlmModel.id;

let isNative = true;
vi.mock('../../platform', () => ({
  Platform: {
    get isNative() {
      return isNative;
    },
  },
}));

/** The listener callback the module under test registered, captured off the
 *  mocked `addListener` call so tests can fire progress events directly. */
function capturedListener(): (p: { modelId: string; bytesDownloaded: number; totalBytes: number }) => void {
  const call = vi.mocked(NativeLlm.addListener).mock.calls.at(-1);
  if (!call) throw new Error('addListener was not called');
  return call[1] as never;
}

describe('native-model-download', () => {
  beforeEach(() => {
    isNative = true;
    useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
    vi.mocked(NativeLlm.isSupported).mockReset().mockResolvedValue({ supported: true });
    vi.mocked(NativeLlm.isModelDownloaded).mockReset().mockResolvedValue({ downloaded: false });
    vi.mocked(NativeLlm.downloadModel).mockReset().mockResolvedValue(undefined);
    vi.mocked(NativeLlm.cancelDownload).mockReset().mockResolvedValue(undefined);
    vi.mocked(NativeLlm.deleteModel).mockReset().mockResolvedValue(undefined);
    vi.mocked(NativeLlm.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
  });

  describe('isNativeModelDownloaded', () => {
    it('returns the plugin result as-is', async () => {
      vi.mocked(NativeLlm.isModelDownloaded).mockResolvedValue({
        downloaded: true,
        sizeBytes: 2_500_000_000,
        path: '/data/models/qwen.gguf',
      });

      await expect(isNativeModelDownloaded()).resolves.toEqual({
        downloaded: true,
        sizeBytes: 2_500_000_000,
        path: '/data/models/qwen.gguf',
      });
      expect(NativeLlm.isModelDownloaded).toHaveBeenCalledWith({ modelId: MODEL_ID });
    });

    it('rejects off a native platform', async () => {
      isNative = false;
      await expect(isNativeModelDownloaded()).rejects.toThrow(NATIVE_MODEL_NOT_AVAILABLE_MESSAGE);
    });
  });

  describe('deleteNativeModel', () => {
    it('calls plugin.deleteModel with the fixed model id', async () => {
      await deleteNativeModel();
      expect(NativeLlm.deleteModel).toHaveBeenCalledWith({ modelId: MODEL_ID });
    });
  });

  describe('downloadNativeModel', () => {
    it('creates a download task tagged with modelId, title, and size', async () => {
      const promise = downloadNativeModel();
      await vi.waitFor(() => expect(useBackgroundTasks.getState().tasks).toHaveLength(1));

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.metadata).toMatchObject({
        title: ASSISTANT.nativeLlmModel.label,
        description: MODEL_ID,
        fileSize: ASSISTANT.nativeLlmModel.approxSizeMb,
        modelId: MODEL_ID,
      });

      await promise;
    });

    it('calls plugin.downloadModel with the model id and url', async () => {
      await downloadNativeModel();
      expect(NativeLlm.downloadModel).toHaveBeenCalledWith({ modelId: MODEL_ID, url: ASSISTANT.nativeLlmModel.url });
    });

    it('reports downloadProgress events onto the task as a percentage plus bytes', async () => {
      let resolveDownload!: () => void;
      vi.mocked(NativeLlm.downloadModel).mockImplementation(
        () => new Promise((resolve) => { resolveDownload = () => resolve(undefined); }),
      );

      const promise = downloadNativeModel();
      await vi.waitFor(() => expect(NativeLlm.addListener).toHaveBeenCalled());

      capturedListener()({ modelId: MODEL_ID, bytesDownloaded: 500, totalBytes: 1000 });

      await vi.waitFor(() => {
        const task = useBackgroundTasks.getState().tasks[0];
        expect(task.progress).toBe(50);
        expect(task.metadata.bytesProcessed).toBe(500);
      });

      resolveDownload();
      await promise;
    });

    it('ignores a progress event for a different modelId', async () => {
      let resolveDownload!: () => void;
      vi.mocked(NativeLlm.downloadModel).mockImplementation(
        () => new Promise((resolve) => { resolveDownload = () => resolve(undefined); }),
      );

      const promise = downloadNativeModel();
      await vi.waitFor(() => expect(NativeLlm.addListener).toHaveBeenCalled());

      capturedListener()({ modelId: 'some-other-model', bytesDownloaded: 500, totalBytes: 1000 });

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.progress).toBe(0);

      resolveDownload();
      await promise;
    });

    it('completes the task and removes the listener when the download resolves', async () => {
      const removeMock = vi.fn();
      vi.mocked(NativeLlm.addListener).mockResolvedValue({ remove: removeMock });

      await downloadNativeModel();

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.status).toBe('completed');
      expect(removeMock).toHaveBeenCalled();
    });

    it('fails the task and removes the listener when the download rejects', async () => {
      const removeMock = vi.fn();
      vi.mocked(NativeLlm.addListener).mockResolvedValue({ remove: removeMock });
      vi.mocked(NativeLlm.downloadModel).mockRejectedValue(new Error('disk full'));

      await downloadNativeModel();

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.status).toBe('failed');
      expect(task.error?.message).toBe('disk full');
      expect(removeMock).toHaveBeenCalled();
    });

    it('cancels (not fails) the task when cancelled via the task store, even if the plugin promise then rejects', async () => {
      let rejectDownload!: (e: Error) => void;
      vi.mocked(NativeLlm.downloadModel).mockImplementation(
        () => new Promise((_resolve, reject) => { rejectDownload = reject; }),
      );

      const promise = downloadNativeModel();
      await vi.waitFor(() => expect(useBackgroundTasks.getState().tasks).toHaveLength(1));
      const taskId = useBackgroundTasks.getState().tasks[0].id;

      useBackgroundTasks.getState().cancelTask(taskId);
      expect(NativeLlm.cancelDownload).toHaveBeenCalled();

      rejectDownload(new Error('cancelled'));
      await promise;

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.status).toBe('cancelled');
    });

    it('cancels the task when cancelled and the plugin promise then resolves', async () => {
      let resolveDownload!: () => void;
      vi.mocked(NativeLlm.downloadModel).mockImplementation(
        () => new Promise((resolve) => { resolveDownload = () => resolve(undefined); }),
      );

      const promise = downloadNativeModel();
      await vi.waitFor(() => expect(useBackgroundTasks.getState().tasks).toHaveLength(1));
      const taskId = useBackgroundTasks.getState().tasks[0].id;

      useBackgroundTasks.getState().cancelTask(taskId);
      resolveDownload();
      await promise;

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.status).toBe('cancelled');
    });

    it('rejects off a native platform without creating a task', async () => {
      isNative = false;
      await expect(downloadNativeModel()).rejects.toThrow(NATIVE_MODEL_NOT_AVAILABLE_MESSAGE);
      expect(useBackgroundTasks.getState().tasks).toHaveLength(0);
    });

    // Reviewer finding: addListener used to run before the try block, so a
    // rejecting bridge call left the task 'pending' forever with no failTask
    // and no way for the caller to observe or recover from it.
    it('fails the task (does not leave it pending forever) when addListener rejects', async () => {
      vi.mocked(NativeLlm.addListener).mockRejectedValue(new Error('bridge unavailable'));

      await downloadNativeModel();

      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.status).toBe('failed');
      expect(task.error?.message).toBe('bridge unavailable');
      expect(NativeLlm.downloadModel).not.toHaveBeenCalled();
    });

    // Reviewer finding: a cancel landing between addTask and downloadModel
    // (e.g. while addListener is still in flight) must not let downloadModel
    // start anyway, since cancelDownload() already ran with nothing in flight
    // to cancel.
    it('bails to cancelTask without calling plugin.downloadModel when cancelled before it starts', async () => {
      let resolveAddListener!: (h: { remove: () => Promise<void> }) => void;
      vi.mocked(NativeLlm.addListener).mockReturnValue(
        new Promise((resolve) => { resolveAddListener = resolve; }),
      );

      const promise = downloadNativeModel();
      await vi.waitFor(() => expect(useBackgroundTasks.getState().tasks).toHaveLength(1));
      const taskId = useBackgroundTasks.getState().tasks[0].id;

      useBackgroundTasks.getState().cancelTask(taskId);
      resolveAddListener({ remove: vi.fn().mockResolvedValue(undefined) });
      await promise;

      expect(NativeLlm.downloadModel).not.toHaveBeenCalled();
      const task = useBackgroundTasks.getState().tasks[0];
      expect(task.status).toBe('cancelled');
    });
  });
});
