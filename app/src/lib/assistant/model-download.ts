/**
 * On-device model download and lifecycle manager (refs #246)
 *
 * There is no separate "download" API in `@mlc-ai/web-llm`: `CreateMLCEngine`
 * both fetches the weights into the Cache API AND loads them onto WebGPU in
 * one call. Once a model is cached, re-creating the engine reads from cache
 * and is fast; there is no way to download without also loading.
 *
 * This module owns the one WebLLM engine the app keeps loaded at a time
 * (`loadedEngine` below) so `webllm.ts`'s provider and the settings UI never
 * juggle their own `MLCEngine` instances. It statically imports
 * `useBackgroundTasks` but only ever calls `.getState()` on it (never
 * subscribes), the same pattern `services/download.ts` already uses: a plain
 * function call into a leaf store, not a React/store dependency edge (rule 31).
 */
import type { AppConfig, ChatOptions, MLCEngine, MLCEngineConfig } from '@mlc-ai/web-llm';
import { useBackgroundTasks } from '../../stores/backgroundTasks';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

interface LoadedEngine {
  modelId: string;
  engine: MLCEngine;
}

/** Thrown by `getLoadedEngine` when `modelId` has no cached weights (never
 *  downloaded, or evicted since). Owned here (not `providers/provider.ts`,
 *  which already imports `webllm.ts` -> this module, so an import the other
 *  way would cycle) and re-exported as `PROVIDER_NOT_AVAILABLE_MESSAGE` so
 *  AskPanel's existing "open Settings" banner also covers this case. */
export const MODEL_NOT_AVAILABLE_MESSAGE = 'On-device model backend is not available yet.';

/** The single engine the app keeps resident on the GPU. Undefined until the
 *  first successful download or cache load. */
let loadedEngine: LoadedEngine | undefined;

/** In-flight `CreateMLCEngine` calls keyed by modelId. `downloadModel` (user
 *  hits Download) and `getLoadedEngine` (a chat turn needs the model) can
 *  both decide to load the same modelId around the same time; without this,
 *  each would start its own `CreateMLCEngine` call and the app would end up
 *  with two engines for the same model resident on the GPU. Callers await
 *  the same promise instead of starting a second one. */
const inFlightEngineLoads = new Map<string, Promise<MLCEngine>>();

/** Cached promise for the one-time `import('@mlc-ai/web-llm')`. A real
 *  browser's module loader already caches a dynamic import by resolved URL,
 *  so repeat calls are free; caching it here too keeps every call site (this
 *  module has four) resolving the exact same module object with no more than
 *  one `import()` in flight at a time. That matters for tests: two calls
 *  issued in the same tick each hit their own uncached `import()` before
 *  either settles, which raced Vitest's mock registration for one of them. */
let webllmModulePromise: Promise<typeof import('@mlc-ai/web-llm')> | undefined;

function loadWebllm(): Promise<typeof import('@mlc-ai/web-llm')> {
  if (!webllmModulePromise) {
    webllmModulePromise = import('@mlc-ai/web-llm');
  }
  return webllmModulePromise;
}

/** `CreateMLCEngine`'s third argument (`chatOpts: ChatOptions`, a
 *  `Partial<ChatConfig>`). web-llm's `reloadInternal` merges this over the
 *  fetched `mlc-chat-config.json` AFTER `ModelRecord.overrides`
 *  (`Object.assign({}, mlcChatConfig, modelRecord.overrides, chatOpts)`), so
 *  this is what actually wins over the prebuilt registry's 4096 cap.
 *
 *  Per model, not global: the models differ in what they were trained for
 *  (Gemma 2 tops out at 8192 natively, the rest are 32K+), and asking for a
 *  window a model wasn't trained for costs VRAM without buying quality. An id
 *  outside `webllmModels` (a saved value predating a list change) falls back
 *  to the registry default by passing no override at all, rather than guessing
 *  a window for a model we know nothing about.
 *
 *  `sliding_window_size: -1` travels with the context window and is not
 *  optional. web-llm throws `WindowSizeConfigurationError` when
 *  `context_window_size` and `sliding_window_size` both resolve positive
 *  (`LLMChatPipeline`, index.js circa L9939), and `sliding_window_size` does
 *  NOT come from the prebuilt registry: it comes from each model's
 *  `mlc-chat-config.json`, fetched from HuggingFace, which the registry
 *  overrides then merge OVER (`Object.assign({}, fetchedConfig,
 *  modelRecord.overrides, chatOpts)`, index.js circa L12477). Of the shipped
 *  models only Gemma 3 1B ships a positive value there (512); the rest already
 *  ship -1, so for them this pin is a no-op that keeps the next
 *  sliding-window model from reintroducing the crash. Pinning -1 selects full
 *  KV-cache mode, as the registry's own Mistral entries do
 *  (`overrides: { context_window_size: 4096, sliding_window_size: -1 }`), and
 *  keeps `attention_sink_size` out of the picture, since that is only required
 *  on the sliding-window branch of the same check.
 *
 *  A previous version of this comment claimed the absence of a registry
 *  override meant `sliding_window_size` resolved to -1 already, and said so as
 *  "Verified". It does not: absence means the fetched config's value stands.
 *  That reasoning held only by luck, because the models shipped at the time
 *  (Qwen, Llama) are not sliding-window models. See rule 41 in AGENTS.md. */
export function chatOptsFor(modelId: string): ChatOptions {
  const model = ASSISTANT.webllmModels.find((m) => m.id === modelId);
  return model ? { context_window_size: model.contextWindowSize, sliding_window_size: -1 } : {};
}

/** Creates the engine for `modelId`, or returns the in-flight promise from a
 *  concurrent caller already loading it. Only the first caller's `config`
 *  (e.g. `downloadModel`'s `initProgressCallback`) takes effect; a caller
 *  that joins an already-in-flight load does not get its own callbacks
 *  attached to `CreateMLCEngine`, since web-llm only takes one config per
 *  call. */
async function createEngineOnce(modelId: string, config?: MLCEngineConfig): Promise<MLCEngine> {
  const existing = inFlightEngineLoads.get(modelId);
  if (existing) {
    return existing;
  }

  // Reserve the map slot synchronously (before the first `await` below) so a
  // second caller reaching this function in the same microtask flush -
  // `getLoadedEngine` and `downloadModel` both await a dynamic import and a
  // cache check before they get here - sees `existing` above and joins this
  // promise instead of racing to also pass the "not found" check.
  const promise = (async () => {
    const webllm = await loadWebllm();
    const engineConfig: MLCEngineConfig = { ...(config ?? {}), appConfig: buildAppConfig(webllm) };
    return webllm.CreateMLCEngine(modelId, engineConfig, chatOptsFor(modelId));
  })();
  inFlightEngineLoads.set(modelId, promise);

  try {
    return await promise;
  } finally {
    inFlightEngineLoads.delete(modelId);
  }
}

function findModel(modelId: string) {
  return ASSISTANT.webllmModels.find((m) => m.id === modelId);
}

/** web-llm stores model weights in the Cache API by default. `caches` is
 *  undefined in non-secure contexts, notably Electron/Tauri loading the app
 *  over `file://` (a packaged desktop build), and some webviews expose it
 *  only intermittently even when `isSecureContext` is true. IndexedDB is
 *  available in those contexts, and web-llm can use it via `useIndexedDBCache`.
 *  Feature-detect the Cache API and fall back to IndexedDB so the download
 *  works wherever the app runs. The SAME config must be passed to
 *  `hasModelInCache` / `CreateMLCEngine` / `deleteModelAllInfoInCache` so they
 *  all read and write the same backend. */
function buildAppConfig(webllm: typeof import('@mlc-ai/web-llm')): AppConfig {
  const cacheBackend: 'cache' | 'indexeddb' = typeof caches === 'undefined' ? 'indexeddb' : 'cache';
  return { ...webllm.prebuiltAppConfig, cacheBackend };
}

/** Whether `modelId`'s weights are already in the Cache API. */
export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const webllm = await loadWebllm();
  return webllm.hasModelInCache(modelId, buildAppConfig(webllm));
}

/** Removes cached weights for `modelId`. Unloads the shared engine first if
 *  it currently holds this model, so no code keeps a reference to freed GPU
 *  memory / evicted cache entries. */
export async function deleteModel(modelId: string): Promise<void> {
  const webllm = await loadWebllm();

  if (loadedEngine?.modelId === modelId) {
    await loadedEngine.engine.unload();
    loadedEngine = undefined;
  }

  await webllm.deleteModelAllInfoInCache(modelId, buildAppConfig(webllm));
  log.assistant(`Deleted cached model "${modelId}"`, LogLevel.INFO, { modelId });
}

export interface DownloadModelOpts {
  signal?: AbortSignal;
}

/** Downloads (== creates the engine for) `modelId`, reporting progress through
 *  a `backgroundTasks` task. Best-effort requests persistent storage first so
 *  the browser is less likely to evict the multi-hundred-MB cache entry under
 *  storage pressure. On success the created engine becomes the shared
 *  singleton `getLoadedEngine` returns; on failure or abort no partial engine
 *  is kept. */
export async function downloadModel(modelId: string, opts: DownloadModelOpts = {}): Promise<void> {
  const { signal } = opts;

  try {
    await navigator.storage?.persist?.();
  } catch (e) {
    log.assistant('navigator.storage.persist() failed (best-effort, continuing)', LogLevel.WARN, { error: e });
  }

  const tasks = useBackgroundTasks.getState();
  const model = findModel(modelId);

  let aborted = signal?.aborted ?? false;
  const taskId = tasks.addTask({
    type: 'download',
    metadata: { title: model?.label ?? modelId, description: modelId, fileSize: model?.approxSizeMb, modelId },
    cancelFn: () => {
      aborted = true;
    },
  });

  if (aborted) {
    tasks.cancelTask(taskId);
    return;
  }

  const onAbort = () => {
    aborted = true;
  };
  signal?.addEventListener('abort', onAbort);

  try {
    const engine = await createEngineOnce(modelId, {
      initProgressCallback: (report) => {
        // web-llm's `CreateMLCEngine` has no abort/cancel API: once cancelFn
        // above sets `aborted`, the underlying fetch keeps running and would
        // keep invoking this callback for the rest of the (possibly
        // multi-hundred-MB) download. Drop those reports so a cancelled task
        // doesn't get flipped back to 'in_progress' (updateProgress hard-sets
        // that status) and re-animate the progress bar after cancel.
        if (aborted) return;
        tasks.updateProgress(taskId, Math.round(report.progress * 100));
      },
    });

    if (aborted) {
      await engine.unload();
      tasks.cancelTask(taskId);
      return;
    }

    loadedEngine = { modelId, engine };
    tasks.completeTask(taskId);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    log.assistant(`downloadModel("${modelId}") failed`, LogLevel.ERROR, { modelId, error });
    if (aborted) {
      tasks.cancelTask(taskId);
    } else {
      tasks.failTask(taskId, error);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Returns the shared engine for `modelId`, loading it from cache if needed.
 *  This is what `WebLlmProvider.chat` calls on every turn.
 *
 *  Deliberately does NOT fall back to a silent multi-hundred-MB download when
 *  the model isn't cached: whether it was never downloaded or the browser
 *  evicted it since, `hasModelInCache` says the same thing (false), and both
 *  cases should surface as an error so the UI can prompt the user to
 *  (re-)download rather than stall a chat request on an unrequested fetch. */
export async function getLoadedEngine(modelId: string): Promise<MLCEngine> {
  if (loadedEngine?.modelId === modelId) {
    return loadedEngine.engine;
  }

  // A different model is resident: free it before loading this one so only
  // one model's weights sit on the GPU at a time.
  if (loadedEngine) {
    await loadedEngine.engine.unload();
    loadedEngine = undefined;
  }

  const webllm = await loadWebllm();
  const cached = await webllm.hasModelInCache(modelId, buildAppConfig(webllm));
  if (!cached) {
    throw new Error(MODEL_NOT_AVAILABLE_MESSAGE);
  }

  const engine = await createEngineOnce(modelId);
  loadedEngine = { modelId, engine };
  return engine;
}

/** Test-only: clears the module-level singleton and in-flight load map
 *  between test cases. */
export function __resetLoadedEngineForTests(): void {
  loadedEngine = undefined;
  inFlightEngineLoads.clear();
}
