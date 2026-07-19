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
  contextWindowSize: 4096,
}] as const;

export type NativeMnnModelId = (typeof NATIVE_MNN_MODEL_IDS)[number];

/** One conversation turn, passed through to MNN's `Llm::response(ChatMessages)`
 *  overload so the model's own chat template puts real role markers around each
 *  turn. Flattening the conversation into a single string instead (which this
 *  bridge used to do) routes through `Llm::response(const std::string&)`, which
 *  wraps the WHOLE blob as one user turn: the system prompt loses system-role
 *  weight and prior assistant turns read as user text the model then copies. */
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
  load(options: { modelId: NativeMnnModelId }): Promise<void>;
  chat(options: { modelId: NativeMnnModelId; messages: NativeMnnMessage[]; maxTokens: number }): Promise<NativeMnnChatResult>;
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

export async function downloadNativeMnnModel(modelId: string): Promise<void> {
  assertNativeModelId(modelId);
  await withPlugin((nativeMnn) => nativeMnn.download({ modelId }));
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
): Promise<NativeMnnChatResult> {
  assertNativeModelId(modelId);
  const result = await withPlugin((nativeMnn) => nativeMnn.chat({ modelId, messages, maxTokens }));
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

export function isNativeMnnModelLoaded(): boolean {
  return modelLoaded;
}

/** Loads the model without generating. Split from `chat` so the panel can say
 *  "loading the model" during the ~10s first load instead of leaving the user
 *  looking at a "thinking" spinner that never moves. */
export async function loadNativeMnnModel(modelId: string): Promise<void> {
  assertNativeModelId(modelId);
  await withPlugin((nativeMnn) => nativeMnn.load({ modelId }));
  modelLoaded = true;
}

export async function unloadNativeMnn(): Promise<void> {
  modelLoaded = false;
  if (!Platform.isNative) return;
  await withPlugin((nativeMnn) => nativeMnn.unload());
}
