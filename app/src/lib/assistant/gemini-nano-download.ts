/**
 * Gemini Nano weight download (refs #270)
 *
 * The Android system model's weights are fetched by AICore on request rather than
 * shipped with the OS, so this backend needs the download surface Apple's does not.
 * Deliberately shaped like `native-model-download.ts`: progress goes through a
 * `backgroundTasks` task, not component state, so a download survives the settings
 * screen unmounting and keeps reporting in the app-level drawer. That is the whole
 * reason this lives here instead of inside `AssistantGeminiNanoSection`.
 *
 * There is no model id and no delete, because there is no model to choose and the
 * weights belong to the system, shared with every other app that uses them.
 */
import { useBackgroundTasks } from '../../stores/backgroundTasks';
import { log, LogLevel } from '../logger';
import { Platform } from '../platform';

/** Thrown when this module is used off Android. Same message the provider throws,
 *  kept as its own copy here (not imported) to avoid a dependency edge from this
 *  module into `providers/`, exactly as `native-model-download.ts` does. */
export const GEMINI_NANO_NOT_AVAILABLE_MESSAGE = 'Gemini Nano is only available on a supported Android device.';

/** Dynamic import behind a platform check (Native contract). Resolves the module
 *  NAMESPACE, not the plugin object: Capacitor's proxy treats `.then` as a native
 *  method, so resolving a promise with the proxy hangs forever on device. */
async function getPlugin() {
  if (!Platform.isNative) throw new Error(GEMINI_NANO_NOT_AVAILABLE_MESSAGE);
  return import('../../plugins/gemini-nano');
}

/**
 * Downloads the Gemini Nano weights, reporting progress through a background task.
 *
 * No `cancelFn`, unlike the native model's download, and that absence is deliberate
 * twice over. AICore owns the transfer and exposes no cancel, and cancelling the
 * underlying future is what crashes the process on the coroutines mismatch
 * documented in `GeminiNanoPlugin.cancelChat`. A task with no `cancelFn` renders
 * without a cancel button, so the drawer already says the right thing.
 *
 * `title` is passed in rather than built here: it is user-facing copy, which the
 * caller has a `t` for and this module does not.
 */
export async function downloadGeminiNanoModel(title: string): Promise<void> {
  const { GeminiNano: plugin } = await getPlugin();
  const tasks = useBackgroundTasks.getState();
  const taskId = tasks.addTask({ type: 'download', metadata: { title, geminiNano: true } });

  // Both `addListener` and `download` run inside the try: an addListener rejection
  // (the bridge call itself failing) has to reach the same failure handling, or the
  // task added above is left pending forever with no way back.
  let handle: Awaited<ReturnType<typeof plugin.addListener>> | undefined;
  try {
    handle = await plugin.addListener('downloadProgress', (p) => {
      // AICore reports the total only once the transfer starts, so the first ticks
      // carry a zero total; guard the divide rather than writing NaN into the task.
      if (p.totalBytes > 0) {
        tasks.updateTaskMetadata(taskId, { fileSize: p.totalBytes });
        tasks.updateProgress(taskId, Math.round((p.bytesDownloaded / p.totalBytes) * 100), p.bytesDownloaded);
      }
    });
    await plugin.download();
    tasks.completeTask(taskId);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    log.assistant('Gemini Nano weight download failed', LogLevel.ERROR, { error });
    tasks.failTask(taskId, error);
    throw error;
  } finally {
    void handle?.remove();
  }
}

/** The in-flight or finished download task for Gemini Nano, for the settings row to
 *  render from. Matched on the metadata flag rather than the title, which is
 *  localized and so not an identity. */
export function findGeminiNanoDownloadTask(tasks: ReturnType<typeof useBackgroundTasks.getState>['tasks']) {
  return tasks.find((task) => task.metadata.geminiNano === true);
}
