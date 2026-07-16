/**
 * model-download.ts tests (refs #246)
 *
 * `@mlc-ai/web-llm` is mocked globally in tests/setup.ts; individual tests
 * here override `CreateMLCEngine` / `hasModelInCache` / `deleteModelAllInfoInCache`
 * to exercise specific lifecycle paths without WebGPU.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as webllm from '@mlc-ai/web-llm';
import type { MLCEngine } from '@mlc-ai/web-llm';
import {
  isModelDownloaded,
  downloadModel,
  deleteModel,
  getLoadedEngine,
  MODEL_NOT_AVAILABLE_MESSAGE,
  __resetLoadedEngineForTests,
} from '../model-download';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';
import { ASSISTANT } from '../../zmninja-ng-constants';

const MODEL_ID = ASSISTANT.webllmModels[0].id;

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
    vi.mocked(webllm.CreateMLCEngine).mockReset();
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockResolvedValue(true) },
      configurable: true,
    });
  });

  describe('isModelDownloaded', () => {
    it('returns true when hasModelInCache resolves true', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      await expect(isModelDownloaded(MODEL_ID)).resolves.toBe(true);
      expect(webllm.hasModelInCache).toHaveBeenCalledWith(MODEL_ID);
    });

    it('returns false when hasModelInCache resolves false', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(false);
      await expect(isModelDownloaded(MODEL_ID)).resolves.toBe(false);
    });
  });

  describe('downloadModel', () => {
    it('requests persistent storage before downloading (best-effort)', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      expect(navigator.storage?.persist).toHaveBeenCalled();
    });

    it('does not fail the download when storage.persist() throws', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: { persist: vi.fn().mockRejectedValue(new Error('denied')) },
        configurable: true,
      });
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks[0].status).toBe('completed');
    });

    it('creates a backgroundTasks download task and completes it on success', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);

      await downloadModel(MODEL_ID);

      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('download');
      expect(tasks[0].status).toBe('completed');
      expect(tasks[0].progress).toBe(100);
      expect(tasks[0].metadata.title).toBe(ASSISTANT.webllmModels[0].label);
    });

    it('reports progress from initProgressCallback', async () => {
      vi.mocked(webllm.CreateMLCEngine).mockImplementation(async (_modelId, config) => {
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

    it('fails the backgroundTasks task when CreateMLCEngine throws', async () => {
      vi.mocked(webllm.CreateMLCEngine).mockRejectedValue(new Error('network error'));

      await downloadModel(MODEL_ID);

      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks[0].status).toBe('failed');
      expect(tasks[0].error?.message).toBe('network error');
    });

    it('does not keep a partial engine and cancels the task when aborted', async () => {
      const engine = makeEngine();
      const controller = new AbortController();
      vi.mocked(webllm.CreateMLCEngine).mockImplementation(async () => {
        controller.abort();
        return engine as never;
      });

      await downloadModel(MODEL_ID, { signal: controller.signal });

      expect(engine.unload).toHaveBeenCalled();
      const tasks = useBackgroundTasks.getState().tasks;
      expect(tasks[0].status).toBe('cancelled');

      // The aborted download must not become the shared engine: a fresh,
      // cached load should still hit CreateMLCEngine again.
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      vi.mocked(webllm.CreateMLCEngine).mockReset().mockResolvedValue(makeEngine() as never);
      await getLoadedEngine(MODEL_ID);
      expect(webllm.CreateMLCEngine).toHaveBeenCalled();
    });

    it('provides a working cancelFn on the task', async () => {
      let resolveCreate!: (value: MLCEngine) => void;
      vi.mocked(webllm.CreateMLCEngine).mockImplementation(
        () => new Promise<MLCEngine>((resolve) => { resolveCreate = resolve; }),
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
      expect(webllm.deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL_ID);
    });

    it('unloads the shared engine first when it holds the deleted model', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);
      await downloadModel(MODEL_ID);

      await deleteModel(MODEL_ID);

      expect(engine.unload).toHaveBeenCalled();
      expect(webllm.deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL_ID);
    });

    it('does not unload an engine loaded for a different model', async () => {
      const otherModelId = ASSISTANT.webllmModels[1].id;
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);
      await downloadModel(otherModelId);

      await deleteModel(MODEL_ID);

      expect(engine.unload).not.toHaveBeenCalled();
    });
  });

  describe('getLoadedEngine', () => {
    it('returns the already-loaded engine for the same modelId without recreating it', async () => {
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);
      await downloadModel(MODEL_ID);
      vi.mocked(webllm.CreateMLCEngine).mockClear();

      const result = await getLoadedEngine(MODEL_ID);

      expect(result).toBe(engine);
      expect(webllm.CreateMLCEngine).not.toHaveBeenCalled();
    });

    it('loads from cache when cached but not currently resident', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const engine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(engine as never);

      const result = await getLoadedEngine(MODEL_ID);

      expect(result).toBe(engine);
      expect(webllm.CreateMLCEngine).toHaveBeenCalledWith(MODEL_ID);
    });

    it('throws MODEL_NOT_AVAILABLE_MESSAGE when not cached (never downloaded or evicted)', async () => {
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(false);

      await expect(getLoadedEngine(MODEL_ID)).rejects.toThrow(MODEL_NOT_AVAILABLE_MESSAGE);
      expect(webllm.CreateMLCEngine).not.toHaveBeenCalled();
    });

    it('unloads the previous engine when switching to a different model', async () => {
      const firstEngine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(firstEngine as never);
      await downloadModel(MODEL_ID);

      const otherModelId = ASSISTANT.webllmModels[1].id;
      vi.mocked(webllm.hasModelInCache).mockResolvedValue(true);
      const secondEngine = makeEngine();
      vi.mocked(webllm.CreateMLCEngine).mockResolvedValue(secondEngine as never);

      const result = await getLoadedEngine(otherModelId);

      expect(firstEngine.unload).toHaveBeenCalled();
      expect(result).toBe(secondEngine);
    });
  });
});
