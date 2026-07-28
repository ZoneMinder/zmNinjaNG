/**
 * The Gemini Nano weight download reports through `backgroundTasks` rather than
 * component state, so it survives the settings screen unmounting (refs #270).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadGeminiNanoModel, findGeminiNanoDownloadTask } from '../gemini-nano-download';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';

let progressListener: ((p: { bytesDownloaded: number; totalBytes: number }) => void) | undefined;
const removeMock = vi.fn().mockResolvedValue(undefined);
let settleDownload: (() => void) | undefined;
let failDownload: ((e: Error) => void) | undefined;
const downloadMock = vi.fn(
  () =>
    new Promise<void>((resolve, reject) => {
      settleDownload = resolve;
      failDownload = reject;
    }),
);

vi.mock('../../../plugins/gemini-nano', () => ({
  GeminiNano: {
    then: () => {
      throw new Error('"GeminiNano.then()" is not implemented (never resolve a promise with the plugin proxy)');
    },
    download: () => downloadMock(),
    addListener: (_event: string, cb: (p: { bytesDownloaded: number; totalBytes: number }) => void) => {
      progressListener = cb;
      return Promise.resolve({ remove: removeMock });
    },
  },
}));

vi.mock('../../platform', () => ({ Platform: { isNative: true } }));

describe('downloadGeminiNanoModel', () => {
  beforeEach(() => {
    useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
    downloadMock.mockClear();
    removeMock.mockClear();
    progressListener = undefined;
  });

  it('reports progress onto a background task and completes it', async () => {
    const run = downloadGeminiNanoModel('Downloading Gemini Nano');
    await vi.waitFor(() => expect(progressListener).toBeDefined());

    progressListener?.({ bytesDownloaded: 250, totalBytes: 1000 });
    const task = findGeminiNanoDownloadTask(useBackgroundTasks.getState().tasks);
    expect(task?.progress).toBe(25);
    expect(task?.metadata.bytesProcessed).toBe(250);
    expect(task?.metadata.fileSize).toBe(1000);

    settleDownload?.();
    await run;
    expect(findGeminiNanoDownloadTask(useBackgroundTasks.getState().tasks)?.status).toBe('completed');
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('ignores the zero-total first tick instead of writing NaN progress', async () => {
    const run = downloadGeminiNanoModel('Downloading Gemini Nano');
    await vi.waitFor(() => expect(progressListener).toBeDefined());

    // AICore reports the total only once the transfer starts.
    progressListener?.({ bytesDownloaded: 0, totalBytes: 0 });
    expect(findGeminiNanoDownloadTask(useBackgroundTasks.getState().tasks)?.progress).toBe(0);

    settleDownload?.();
    await run;
  });

  it('fails the task, and rethrows, when the download rejects', async () => {
    const run = downloadGeminiNanoModel('Downloading Gemini Nano');
    await vi.waitFor(() => expect(progressListener).toBeDefined());

    failDownload?.(new Error('no disk space'));
    await expect(run).rejects.toThrow('no disk space');
    const task = findGeminiNanoDownloadTask(useBackgroundTasks.getState().tasks);
    expect(task?.status).toBe('failed');
    expect(task?.error?.message).toBe('no disk space');
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('offers no cancel, because AICore owns the transfer and cancelling it crashes', async () => {
    const run = downloadGeminiNanoModel('Downloading Gemini Nano');
    await vi.waitFor(() => expect(progressListener).toBeDefined());
    expect(findGeminiNanoDownloadTask(useBackgroundTasks.getState().tasks)?.cancelFn).toBeUndefined();
    settleDownload?.();
    await run;
  });
});
