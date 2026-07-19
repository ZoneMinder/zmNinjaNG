/** Native MNN bridge for on-device assistant models (refs #246).
 *
 * The native runtime ships in the app. This bridge accepts only a model id;
 * Android and iOS own the pinned download manifest and verify every file.
 */
import { Platform } from '../platform';

export const NATIVE_MNN_MODEL_IDS = [
  'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN',
] as const;

export const NATIVE_MNN_MODELS = [{
  id: 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN',
  label: 'Qwen3.5 2B Reasoning',
  approxSizeMb: 1383,
  // Not a model limit: llm_config.json declares no sequence length and MNN
  // enforces none, so this is our own memory-driven ceiling. The previous 4096
  // was invented, and small enough that an ordinary turn (system prompt + tool
  // catalog + one tool result) measured 4353 and looked like an overflow that
  // was not real. The model's own config sets max_new_tokens to 8192, so it is
  // built for at least this much working space; the real cost of raising it is
  // KV cache memory, which is why it is not raised further.
  contextWindowSize: 8192,
}] as const;

export type NativeMnnModelId = (typeof NATIVE_MNN_MODEL_IDS)[number];

/** One conversation turn, passed through to MNN's `Llm::response(ChatMessages)`
 *  overload so the model's own chat template puts real role markers around each
 *  turn. Flattening the conversation into a single string instead (which this
 *  bridge used to do) routes through `Llm::response(const std::string&)`, which
 *  wraps the WHOLE blob as one user turn: the system prompt loses system-role
 *  weight and prior assistant turns read as user text the model then copies. */
/** Backends the native side can report. Kept in sync with
 *  zmninjaMnnBackendName in native/mnn-runtime-config.h. */
export const NATIVE_MNN_BACKENDS = ['metal', 'opencl', 'vulkan', 'cpu'] as const;
export type NativeMnnBackend = (typeof NATIVE_MNN_BACKENDS)[number];

export interface NativeMnnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface NativeMnnPlugin {
  isDownloaded(options: { modelId: NativeMnnModelId }): Promise<{ downloaded: boolean }>;
  download(options: { modelId: NativeMnnModelId }): Promise<void>;
  cancelDownload(): Promise<void>;
  deleteModel(options: { modelId: NativeMnnModelId }): Promise<void>;
  getModelSize(options: { modelId: NativeMnnModelId }): Promise<{ bytes: number }>;
  load(options: { modelId: NativeMnnModelId; useGpu: boolean }): Promise<{ backend: string }>;
  chat(options: { modelId: NativeMnnModelId; messages: NativeMnnMessage[]; maxTokens: number; useGpu: boolean }): Promise<NativeMnnChatResult>;
  unload(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listener: (progress: NativeMnnDownloadProgress) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

/** MNN reports its own token counts, so `isContextNearlyFull` measures the
 *  real prompt size instead of guessing from characters (refs #246). */
export interface NativeMnnChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export interface NativeMnnDownloadProgress {
  modelId: NativeMnnModelId;
  fileName: string;
  fileIndex: number;
  fileCount: number;
  fileProgress: number;
  fileBytesWritten: number;
  fileBytesTotal: number;
}

export interface NativeMnnListenerSource {
  addListener(
    eventName: 'downloadProgress',
    listener: (progress: NativeMnnDownloadProgress) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

let plugin: NativeMnnPlugin | undefined;
let pluginLoader: Promise<void> | undefined;

function assertNativeModelId(modelId: string): asserts modelId is NativeMnnModelId {
  if (!NATIVE_MNN_MODEL_IDS.includes(modelId as NativeMnnModelId)) {
    throw new Error(`Unsupported native MNN model: ${modelId}`);
  }
}

async function withPlugin<T>(callback: (plugin: NativeMnnPlugin) => Promise<T>): Promise<T> {
  if (!Platform.isNative) throw new Error('Native MNN is unavailable on this platform.');
  if (!pluginLoader) {
    pluginLoader = import('@capacitor/core').then(({ registerPlugin }) => {
      plugin = registerPlugin<NativeMnnPlugin>('NativeMnn');
    });
  }
  await pluginLoader;
  return callback(plugin!);
}

export async function getNativeMnnListenerSource(): Promise<NativeMnnListenerSource> {
  await withPlugin(async () => undefined);
  return { addListener: (eventName, listener) => plugin!.addListener(eventName, listener) };
}

export function supportsNativeMnnModel(modelId: string): modelId is NativeMnnModelId {
  return NATIVE_MNN_MODEL_IDS.includes(modelId as NativeMnnModelId);
}

export async function isNativeMnnModelDownloaded(modelId: string): Promise<boolean> {
  assertNativeModelId(modelId);
  return withPlugin((nativeMnn) => nativeMnn.isDownloaded({ modelId }).then((result) => result.downloaded));
}

/**
 * The download in flight, if any, held at module level rather than in React
 * state.
 *
 * The native download is a detached task: it keeps running when the settings
 * screen unmounts. When the state describing it lived in the component, leaving
 * the screen and coming back lost the "downloading" flag, which in turn
 * disabled the progress listener, so a download that was still running showed
 * no progress at all until it finished (refs #246).
 */
export interface NativeMnnDownloadState {
  modelId: NativeMnnModelId;
  progress?: NativeMnnDownloadProgress;
}

let activeDownload: NativeMnnDownloadState | undefined;
const downloadListeners = new Set<() => void>();
let progressListenerAttached = false;

function emitDownloadChange(): void {
  for (const listener of downloadListeners) listener();
}

/** Subscribe/getSnapshot pair for `useSyncExternalStore`. The snapshot is a
 *  stable reference between emits, as that hook requires. */
export function subscribeNativeMnnDownload(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

export function getNativeMnnDownload(): NativeMnnDownloadState | undefined {
  return activeDownload;
}

/** Attached once for the process, never removed: progress must keep being
 *  recorded while no component is mounted to hear it. */
async function attachProgressListener(): Promise<void> {
  if (progressListenerAttached) return;
  progressListenerAttached = true;
  try {
    await withPlugin(async (nativeMnn) => {
      await nativeMnn.addListener('downloadProgress', (progress) => {
        if (!activeDownload || progress.modelId !== activeDownload.modelId) return;
        activeDownload = { ...activeDownload, progress };
        emitDownloadChange();
      });
    });
  } catch (error) {
    progressListenerAttached = false;
    throw error;
  }
}

export async function downloadNativeMnnModel(modelId: string): Promise<void> {
  assertNativeModelId(modelId);
  await attachProgressListener();
  activeDownload = { modelId };
  emitDownloadChange();
  try {
    await withPlugin((nativeMnn) => nativeMnn.download({ modelId }));
  } finally {
    // Cleared even when the caller has unmounted and nobody is awaiting this,
    // so a later visit to the screen does not see a stale download.
    activeDownload = undefined;
    emitDownloadChange();
  }
}

/** Aborts an in-flight `downloadNativeMnnModel`, which then rejects and leaves
 *  nothing on disk (the native side deletes the partial model directory). */
export async function cancelNativeMnnDownload(): Promise<void> {
  await withPlugin((nativeMnn) => nativeMnn.cancelDownload());
}

/** On-disk bytes of the model directory, 0 when nothing is downloaded. */
export async function getNativeMnnModelSize(modelId: string): Promise<number> {
  assertNativeModelId(modelId);
  return withPlugin((nativeMnn) => nativeMnn.getModelSize({ modelId }).then((result) => result.bytes));
}

export async function deleteNativeMnnModel(modelId: string): Promise<void> {
  assertNativeModelId(modelId);
  await withPlugin((nativeMnn) => nativeMnn.deleteModel({ modelId }));
}

export async function nativeMnnChat(
  modelId: string,
  messages: NativeMnnMessage[],
  maxTokens: number,
  useGpu = false,
): Promise<NativeMnnChatResult> {
  assertNativeModelId(modelId);
  const result = await withPlugin((nativeMnn) => nativeMnn.chat({ modelId, messages, maxTokens, useGpu }));
  modelLoaded = true;
  return result;
}

/**
 * Whether a model is currently resident in native memory.
 *
 * Tracked here rather than asked of the plugin because the answer is needed
 * synchronously, to decide whether to tell the user a load is about to happen
 * BEFORE the call that would block on it. It mirrors the native side's own
 * "already loaded?" check: set by `loadNativeMnnModel`/`nativeMnnChat`, cleared
 * by `unloadNativeMnn`.
 */
let modelLoaded = false;
let loadedBackend: NativeMnnBackend | undefined;
let gpuCrashed = false;

export function isNativeMnnModelLoaded(): boolean {
  return modelLoaded;
}

/** The backend the last load actually resolved to, or undefined before any
 *  load. Reported by the native side AFTER MNN's own fallback, so it reflects
 *  what is really running rather than what was requested. */
export function getNativeMnnBackend(): NativeMnnBackend | undefined {
  return loadedBackend;
}

/** Loads the model without generating. Split from `chat` so the panel can say
 *  "loading the model" during the ~10s first load instead of leaving the user
 *  looking at a "thinking" spinner that never moves. */
export async function loadNativeMnnModel(modelId: string, useGpu = false): Promise<NativeMnnBackend> {
  assertNativeModelId(modelId);
  const { backend } = await withPlugin((nativeMnn) => nativeMnn.load({ modelId, useGpu }));
  // A trailing "!" means the GPU took the whole process down on a previous
  // launch and CPU was forced for good. The native side can only report that
  // after the fact: a backend that segfaults cannot be caught, only remembered.
  gpuCrashed = backend.endsWith('!');
  const name = gpuCrashed ? backend.slice(0, -1) : backend;
  loadedBackend = NATIVE_MNN_BACKENDS.includes(name as NativeMnnBackend) ? (name as NativeMnnBackend) : 'cpu';
  modelLoaded = true;
  return loadedBackend;
}

/** Whether the current CPU backend is a permanent fall back after a GPU crash,
 *  rather than simply the best this device offers. */
export function didGpuCrash(): boolean {
  return gpuCrashed;
}

export async function unloadNativeMnn(): Promise<void> {
  modelLoaded = false;
  loadedBackend = undefined;
  gpuCrashed = false;
  if (!Platform.isNative) return;
  await withPlugin((nativeMnn) => nativeMnn.unload());
}
