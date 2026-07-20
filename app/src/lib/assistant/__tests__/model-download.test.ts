/**
 * model-download.ts tests (refs #246)
 *
 * `@mlc-ai/web-llm` is mocked globally in tests/setup.ts; individual tests
 * here override `CreateWebWorkerMLCEngine` / `hasModelInCache` / `deleteModelAllInfoInCache`
 * to exercise specific lifecycle paths without WebGPU.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as webllm from '@mlc-ai/web-llm';
import type { AppConfig } from '@mlc-ai/web-llm';
import {
  isModelDownloaded,
  downloadModel,
  deleteModel,
  getLoadedEngine,
  MODEL_NOT_AVAILABLE_MESSAGE,
  chatOptsFor,
  __resetLoadedEngineForTests,
} from '../model-download';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';
import { ASSISTANT } from '../../zmninja-ng-constants';

const MODEL_ID = ASSISTANT.webllmModels[0].id;
/** A second id for the "engine loaded for a different model" cases. Not taken
 *  from `webllmModels`, which now lists exactly one supported model: these
 *  tests only need two ids that differ, and a retired id is still a real
 *  web-llm registry id that a persisted setting could hold. */
const OTHER_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';

function makeEngine() {
  return {
    chat: { completions: { create: vi.fn() } },
    unload: vi.fn().mockResolvedValue(undefined),
  };
}

describe('model-download', () => {
  beforeEach(() => {
    useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
    __resetLoadedEngineForTests();
    vi.mocked(webllm.hasModelInCache).mockReset().mockResolvedValue(false);
    vi.mocked(webllm.deleteModelAllInfoInCache).mockReset().mockResolvedValue(undefined);
    vi.mocked(webllm.CreateWebWorkerMLCEngine).mockReset();
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockResolvedValue(true) },
      configurable: true,
    });
  });

  describe('isModelDownloaded', () => {
    it('returns true when hasModelInCache resolves true', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      await expect(isModelDownloaded(MODEL_ID)).resolves.toBe(true);
      expect(webllm.hasModelInCache).toHaveBeenCalledWith(MODEL_ID, expect.any(Object));
    });

    it('returns false when hasModelInCache resolves false', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(false);
      await expect(isModelDownloaded(MODEL_ID)).resolves.toBe(false);
    });
  });

  describe('downloadModel', () => {
    it('unloads the resident model before loading a different model', async () => {
      const firstEngine = makeEngine();
      const secondEngine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine)
        .mockResolvedValueOnce(firstEngine as never)
        .mockResolvedValueOnce(secondEngine as never);

      await downloadModel(MODEL_ID);
      await downloadModel(OTHER_MODEL_ID);

      expect(firstEngine.unload).toHaveBeenCalledOnce();
    });

    it('requests persistent storage before downloading (best-effort)', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      expect(navigator.storage?.persist).toHaveBeenCalled();
    });

    it('does not fail the download when storage.persist() throws', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: { persist: vi.fn().mockRejectedValue(new Error('denied')) },
        configurable: true,
      });
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks[0].status).toBe('completed');
    });

    it('creates a backgroundTasks download task and completes it on success', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('download');
      expect(tasks[0].status).toBe('completed');
      expect(tasks[0].progress).toBe(100);
      expect(tasks[0].metadata.title).toBe(ASSISTANT.webllmModels[0].label);
    });

    it('reports progress from initProgressCallback', async () => {
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockImplementation(async (_worker, _modelId, config) => {
        config?.initProgressCallback?.({ progress: 0.25, timeElapsed: 1, text: '' });
        config?.initProgressCallback?.({ progress: 0.75, timeElapsed: 2, text: '' });
        return makeEngine() as never;
      });

      const progressUpdates: number[] = [];
      const unsubscribe = useBackgroundTasks.subscribe((state) => {
        const task = state.tasks[0];
        if (task) progressUpdates.push(task.progress);
      });

      await downloadModel(MODEL_ID);
      unsubscribe();

      expect(progressUpdates).toContain(25);
      expect(progressUpdates).toContain(75);
    });

    it('fails the backgroundTasks task when CreateWebWorkerMLCEngine throws', async () => {
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockRejectedValue(new Error('network error'));

      await downloadModel(MODEL_ID);

      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks[0].status).toBe('failed');
      expect(tasks[0].error?.message).toBe('network error');
    });

    it('does not keep a partial engine and cancels the task when aborted', async () => {
      const engine = makeEngine();
      const controller = new AbortController();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockImplementation(async () => {
        controller.abort();
        return engine as never;
      });

      await downloadModel(MODEL_ID, { signal: controller.signal });

      expect(engine.unload).toHaveBeenCalled();
      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks[0].status).toBe('cancelled');

      // The aborted download must not become the shared engine: a fresh,
      // cached load should still hit CreateWebWorkerMLCEngine again.
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockReset().mockResolvedValue(makeEngine() as never);
      await getLoadedEngine(MODEL_ID);
      expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalled();
    });

    it('ignores progress reports that arrive after cancellation instead of resurrecting the task to in_progress', async () => {
      // web-llm's `CreateWebWorkerMLCEngine` has no abort: the mock never resolves,
      // mimicking the underlying fetch continuing to run (and to invoke the
      // progress callback) after the user cancels.
      let progressCb: ((report: { progress: number; timeElapsed: number; text: string }) => void) | undefined;
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockImplementation(async (_worker, _modelId, config) => {
        progressCb = config?.initProgressCallback;
        return new Promise<never>(() => {});
      });

      const downloadPromise = downloadModel(MODEL_ID);
      await vi.waitFor(() => expect(useBackgroundTasks.getState().tasks).toHaveLength(1));
      const taskId = useBackgroundTasks.getState().tasks[0].id;

      // A progress report before cancellation still updates the task normally.
      progressCb?.({ progress: 0.3, timeElapsed: 1, text: '' });
      expect(useBackgroundTasks.getState().tasks[0].status).toBe('in_progress');
      expect(useBackgroundTasks.getState().tasks[0].progress).toBe(30);

      useBackgroundTasks.getState().cancelTask(taskId);
      expect(useBackgroundTasks.getState().tasks[0].status).toBe('cancelled');

      const updateProgressSpy = vi.spyOn(useBackgroundTasks.getState(), 'updateProgress');
      progressCb?.({ progress: 0.9, timeElapsed: 2, text: '' });

      expect(updateProgressSpy).not.toHaveBeenCalled();
      const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId);
      expect(task?.status).toBe('cancelled');
      expect(task?.progress).toBe(30);

      void downloadPromise; // deliberately never resolves in this test
    });

    it('provides a working cancelFn on the task', async () => {
      let resolveCreate!: (value: never) => void;
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockImplementation(
        () => new Promise<never>((resolve) => { resolveCreate = resolve; }),
      );

      const downloadPromise = downloadModel(MODEL_ID);
      await vi.waitFor(() => expect(useBackgroundTasks.getState().tasks).toHaveLength(1));
      const taskId = useBackgroundTasks.getState().tasks[0].id;
      useBackgroundTasks.getState().cancelTask(taskId);
      resolveCreate(makeEngine() as never);
      await downloadPromise;

      const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId);
      expect(task?.status).toBe('cancelled');
    });
  });

  describe('deleteModel', () => {
    it('calls deleteModelAllInfoInCache for modelId', async () => {
      await deleteModel(MODEL_ID);
      expect(webllm.deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL_ID, expect.any(Object));
    });

    it('unloads the shared engine first when it holds the deleted model', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);
      await downloadModel(MODEL_ID);

      await deleteModel(MODEL_ID);

      expect(engine.unload).toHaveBeenCalled();
      expect(webllm.deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL_ID, expect.any(Object));
    });

    it('does not unload an engine loaded for a different model', async () => {
      const otherModelId = OTHER_MODEL_ID;
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);
      await downloadModel(otherModelId);

      await deleteModel(MODEL_ID);

      expect(engine.unload).not.toHaveBeenCalled();
    });
  });

  describe('getLoadedEngine', () => {
    it('returns the already-loaded engine for the same modelId without recreating it', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);
      await downloadModel(MODEL_ID);
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockClear();

      const result = await getLoadedEngine(MODEL_ID);

      expect(result).toBe(engine);
      expect(webllm.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
    });

    it('loads from cache when cached but not currently resident', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      const result = await getLoadedEngine(MODEL_ID);

      expect(result).toBe(engine);
      expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalledWith(expect.anything(), MODEL_ID, expect.any(Object), expect.any(Object));
    });

    it('throws MODEL_NOT_AVAILABLE_MESSAGE when not cached (never downloaded or evicted)', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(false);

      await expect(getLoadedEngine(MODEL_ID)).rejects.toThrow(MODEL_NOT_AVAILABLE_MESSAGE);
      expect(webllm.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
    });

    it('dedupes two concurrent getLoadedEngine calls for the same modelId into a single CreateWebWorkerMLCEngine call', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const engine = makeEngine();
      let resolveCreate!: (value: never) => void;
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockImplementation(
        () => new Promise<never>((resolve) => { resolveCreate = resolve; }),
      );

      const p1 = getLoadedEngine(MODEL_ID);
      const p2 = getLoadedEngine(MODEL_ID);
      await vi.waitFor(() => expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalled());
      resolveCreate(engine as never);
      const [result1, result2] = await Promise.all([p1, p2]);

      expect(result1).toBe(engine);
      expect(result2).toBe(engine);
      expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalledTimes(1);
    });

    it('unloads the previous engine when switching to a different model', async () => {
      const firstEngine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(firstEngine as never);
      await downloadModel(MODEL_ID);

      const otherModelId = OTHER_MODEL_ID;
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const secondEngine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(secondEngine as never);

      const result = await getLoadedEngine(otherModelId);

      expect(firstEngine.unload).toHaveBeenCalled();
      expect(result).toBe(secondEngine);
    });
  });

  describe('buildAppConfig cache backend fallback', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('isModelDownloaded passes cacheBackend "indexeddb" when the Cache API is unavailable (e.g. file://)', async () => {
      vi.stubGlobal('caches', undefined);
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);

      await isModelDownloaded(MODEL_ID);

      expect(webllm.hasModelInCache).toHaveBeenCalledWith(MODEL_ID, expect.objectContaining({ cacheBackend: 'indexeddb' }));
    });

    it('isModelDownloaded passes cacheBackend "cache" when the Cache API is available', async () => {
      vi.stubGlobal('caches', {});
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);

      await isModelDownloaded(MODEL_ID);

      expect(webllm.hasModelInCache).toHaveBeenCalledWith(MODEL_ID, expect.objectContaining({ cacheBackend: 'cache' }));
    });

    it('downloadModel passes the same appConfig into CreateWebWorkerMLCEngine', async () => {
      vi.stubGlobal('caches', undefined);
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      const [, , config] = vi.mocked(webllm.CreateWebWorkerMLCEngine).mock.calls[0];
      expect((config as { appConfig?: AppConfig } | undefined)?.appConfig).toEqual(
        expect.objectContaining({ cacheBackend: 'indexeddb' }),
      );
    });

    it('getLoadedEngine checks the cache with the same indexeddb-fallback appConfig used by CreateWebWorkerMLCEngine', async () => {
      // Regression guard: getLoadedEngine used to call hasModelInCache(modelId)
      // with no appConfig at all, which defaults to web-llm's prebuiltAppConfig
      // (cacheBackend: "cache"). Under file:// that silently disagrees with the
      // indexeddb fallback CreateWebWorkerMLCEngine uses, so a model downloaded under
      // the indexeddb backend would look "not cached" on the next chat turn.
      vi.stubGlobal('caches', undefined);
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await getLoadedEngine(MODEL_ID);

      expect(webllm.hasModelInCache).toHaveBeenCalledWith(MODEL_ID, expect.objectContaining({ cacheBackend: 'indexeddb' }));
    });
  });

  describe('chatOpts (context window override, refs #246)', () => {
    it('passes the context window override as the third CreateWebWorkerMLCEngine argument, and appConfig on the second', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      const [, , engineConfig, chatOpts] = vi.mocked(webllm.CreateWebWorkerMLCEngine).mock.calls[0];
      expect(chatOpts).toEqual({
        context_window_size: ASSISTANT.webllmModels[0].contextWindowSize,
        sliding_window_size: -1,
      });
      expect((engineConfig as { appConfig?: AppConfig } | undefined)?.appConfig).toEqual(
        expect.objectContaining({ cacheBackend: expect.any(String) }),
      );
    });

    it('getLoadedEngine also passes the context window override as the third argument', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const engine = makeEngine();
      vi.mocked(webllm.CreateWebWorkerMLCEngine).mockResolvedValue(engine as never);

      await getLoadedEngine(MODEL_ID);

      const [, , , chatOpts] = vi.mocked(webllm.CreateWebWorkerMLCEngine).mock.calls[0];
      expect(chatOpts).toEqual({
        context_window_size: ASSISTANT.webllmModels[0].contextWindowSize,
        sliding_window_size: -1,
      });
    });

    // Gemma is a sliding-window-attention model: its mlc-chat-config.json (
    // fetched from HuggingFace, NOT the prebuilt registry) carries a positive
    // sliding_window_size, and web-llm throws WindowSizeConfigurationError if
    // both windows resolve positive. Pairing -1 with our context_window_size is
    // exactly what the registry's own Mistral entries do.
    it('pins sliding_window_size to -1 whenever it sets a context window', () => {
      for (const model of ASSISTANT.webllmModels) {
        expect(chatOptsFor(model.id)).toEqual({
          context_window_size: model.contextWindowSize,
          sliding_window_size: -1,
        });
      }
    });

    // The list is down to one supported model, so this no longer proves the
    // windows differ between models (they cannot). It still pins the value to
    // the registry entry rather than a constant written into chatOptsFor,
    // which is what the override exists for.
    it('takes each listed model window from its registry entry, not a global value', () => {
      for (const model of ASSISTANT.webllmModels) {
        expect(chatOptsFor(model.id).context_window_size).toBe(model.contextWindowSize);
      }
    });

    it('sends no override for a model outside the list, leaving web-llm its own default', () => {
      // A saved id from an older build. Guessing a window for a model we never
      // characterised is worse than letting the registry's 4096 stand.
      expect(chatOptsFor('some-unlisted-model-MLC')).toEqual({});
    });

    it('never exceeds the cap that keeps the KV cache bounded', () => {
      for (const model of ASSISTANT.webllmModels) {
        expect(model.contextWindowSize).toBeLessThanOrEqual(ASSISTANT.contextWindowCap);
      }
    });
  });
});
