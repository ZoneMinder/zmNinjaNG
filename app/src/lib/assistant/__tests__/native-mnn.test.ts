import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isDownloaded, cancelDownload, getModelSize, registerPlugin } = vi.hoisted(() => ({
  isDownloaded: vi.fn(),
  cancelDownload: vi.fn(),
  getModelSize: vi.fn(),
  registerPlugin: vi.fn(),
}));

vi.mock('../../platform', () => ({
  Platform: { isNative: true },
}));

vi.mock('@capacitor/core', () => ({ registerPlugin }));

describe('native MNN bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    isDownloaded.mockReset().mockResolvedValue({ downloaded: false });
    cancelDownload.mockReset().mockResolvedValue(undefined);
    getModelSize.mockReset().mockResolvedValue({ bytes: 1_450_000_000 });
    registerPlugin.mockReset().mockReturnValue(new Proxy({ isDownloaded, cancelDownload, getModelSize }, {
      get(target, property) {
        if (property === 'then') return vi.fn();
        return Reflect.get(target, property);
      },
    }));
  });

  it('does not await Capacitor plugin proxy as a thenable', async () => {
    const { isNativeMnnModelDownloaded } = await import('../native-mnn');

    await expect(isNativeMnnModelDownloaded('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN')).resolves.toBe(false);
    expect(isDownloaded).toHaveBeenCalledWith({ modelId: 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN' });
  });

  it('cancels an in-flight download through the plugin', async () => {
    const { cancelNativeMnnDownload } = await import('../native-mnn');

    await expect(cancelNativeMnnDownload()).resolves.toBeUndefined();
    expect(cancelDownload).toHaveBeenCalled();
  });

  it('reports the on-disk model size', async () => {
    const { getNativeMnnModelSize } = await import('../native-mnn');

    await expect(getNativeMnnModelSize('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN')).resolves.toBe(1_450_000_000);
    expect(getModelSize).toHaveBeenCalledWith({ modelId: 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN' });
  });

  it('rejects an unsupported model id before touching the plugin', async () => {
    const { getNativeMnnModelSize } = await import('../native-mnn');

    await expect(getNativeMnnModelSize('nope')).rejects.toThrow('Unsupported native MNN model');
    expect(getModelSize).not.toHaveBeenCalled();
  });

  // The backend is reported by native code AFTER MNN's own CPU fallback, so a
  // device with no usable GPU driver must not leave the app claiming GPU.
  it('records the backend the native side actually resolved to', async () => {
    const load = vi.fn().mockResolvedValue({ backend: 'metal' });
    registerPlugin.mockReturnValue({ load });
    const { loadNativeMnnModel, getNativeMnnBackend } = await import('../native-mnn');

    await expect(loadNativeMnnModel('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN')).resolves.toBe('metal');
    expect(getNativeMnnBackend()).toBe('metal');
  });

  it('falls back to cpu for a backend name it does not recognise', async () => {
    const load = vi.fn().mockResolvedValue({ backend: 'something-new' });
    registerPlugin.mockReturnValue({ load });
    const { loadNativeMnnModel } = await import('../native-mnn');

    await expect(loadNativeMnnModel('Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN')).resolves.toBe('cpu');
  });
});
