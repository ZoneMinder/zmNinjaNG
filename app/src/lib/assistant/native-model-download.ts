/**
 * Native (llama.cpp bridge) model download and lifecycle wrapper (refs #270)
 *
 * Mirrors `model-download.ts`'s `downloadModel`/`deleteModel`/`isModelDownloaded`,
 * but delegates the actual fetch/storage/deletion to the native `NativeLlm`
 * Capacitor plugin instead of web-llm's Cache API. There is exactly one native
 * model (`ASSISTANT.nativeLlmModel`), unlike the WebLLM picker, so nothing
 * here takes a `modelId` parameter.
 */
import { useBackgroundTasks } from '../../stores/backgroundTasks';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';
import { Platform } from '../platform';

/** Thrown when this module is used off a native platform (web, Electron):
 *  the llama.cpp bridge only exists in the iOS/Android build. Same message
 *  `NativeLlmProvider` throws, kept as its own copy here (not imported) to
 *  avoid a dependency edge from this service into `providers/`. */
export const NATIVE_MODEL_NOT_AVAILABLE_MESSAGE = 'On-device native model backend is only available on iOS or Android.';

const MODEL_ID = ASSISTANT.nativeLlmModel.id;

/** Dynamic import behind a platform check (rule 13): the plugin package is
 *  native-only, so importing it eagerly would pull native bridge code into
 *  the web/Electron bundle for a backend those platforms can never run. */
async function getPlugin() {
  if (!Platform.isNative) throw new Error(NATIVE_MODEL_NOT_AVAILABLE_MESSAGE);
  // Resolves with the module namespace, NOT the plugin object: Capacitor's
  // registerPlugin proxy intercepts every property access as a native method
  // call, so resolving a promise with the proxy makes the JS runtime probe
  // `.then` on it, which the native side rejects as unimplemented while the
  // awaiting promise hangs forever (seen on device as a stuck 'checking'
  // state, refs #270). Callers destructure `NativeLlm` AFTER the await.
  return import('../../plugins/native-llm');
}

export interface NativeModelStatus {
  downloaded: boolean;
  sizeBytes?: number;
  path?: string;
}

/** Whether the native model's weights are already on disk, plus their size
 *  and path so the settings UI can show storage info without a separate
 *  browser-storage probe (native models don't live in a browser partition). */
export async function isNativeModelDownloaded(): Promise<NativeModelStatus> {
  const { NativeLlm: plugin } = await getPlugin();
  return plugin.isModelDownloaded({ modelId: MODEL_ID });
}

/** Removes the downloaded native model. */
export async function deleteNativeModel(): Promise<void> {
  const { NativeLlm: plugin } = await getPlugin();
  await plugin.deleteModel({ modelId: MODEL_ID });
  log.assistant(`Deleted native model "${MODEL_ID}"`, LogLevel.INFO, { modelId: MODEL_ID });
}

/** Downloads the native model, reporting progress through a `backgroundTasks`
 *  task (same task shape `model-download.ts`'s `downloadModel` uses, so
 *  `AssistantSection` matches it back to the model the same way). The plugin's
 *  `downloadModel()` call resolves or rejects when the native side is done;
 *  cancellation is tracked locally (mirrors `model-download.ts`'s `aborted`
 *  flag) so a cancel is always reported as `cancelTask`, whichever way that
 *  promise settles. */
export async function downloadNativeModel(): Promise<void> {
  const { NativeLlm: plugin } = await getPlugin();
  const tasks = useBackgroundTasks.getState();
  const { label, url, approxSizeMb } = ASSISTANT.nativeLlmModel;

  let cancelled = false;
  const taskId = tasks.addTask({
    type: 'download',
    metadata: { title: label, description: MODEL_ID, fileSize: approxSizeMb, modelId: MODEL_ID },
    cancelFn: () => {
      if (cancelled) return;
      cancelled = true;
      void plugin.cancelDownload().catch((error) =>
        log.assistant('Native LLM cancelDownload failed', LogLevel.WARN, { error }),
      );
    },
  });

  // Both `addListener` and `downloadModel` run inside the try: an addListener
  // rejection (the bridge call itself failing) must reach the same
  // fail/cancel handling as a downloadModel rejection, or the task the
  // earlier addTask() created is left 'pending' forever with no recovery.
  let handle: Awaited<ReturnType<typeof plugin.addListener>> | undefined;
  try {
    handle = await plugin.addListener('downloadProgress', (p) => {
      if (cancelled || p.modelId !== MODEL_ID) return;
      const pct = p.totalBytes > 0 ? Math.round((p.bytesDownloaded / p.totalBytes) * 100) : 0;
      tasks.updateProgress(taskId, pct, p.bytesDownloaded);
    });

    // A cancel that landed while addListener was in flight: nothing has
    // started on the native side yet, so bail without ever calling
    // downloadModel (cancelFn already asked the plugin to cancel, which
    // would otherwise have nothing in flight to cancel).
    if (cancelled) {
      tasks.cancelTask(taskId);
      return;
    }

    await plugin.downloadModel({ modelId: MODEL_ID, url });
    if (cancelled) {
      tasks.cancelTask(taskId);
    } else {
      tasks.completeTask(taskId);
    }
  } catch (e) {
    if (cancelled) {
      tasks.cancelTask(taskId);
    } else {
      const error = e instanceof Error ? e : new Error(String(e));
      log.assistant(`downloadNativeModel("${MODEL_ID}") failed`, LogLevel.ERROR, { error });
      tasks.failTask(taskId, error);
    }
  } finally {
    void handle?.remove();
  }
}
