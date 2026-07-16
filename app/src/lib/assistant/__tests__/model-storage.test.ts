/**
 * model-storage.ts tests (refs #246)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getModelStorageInfo, formatStorageBytes } from '../model-storage';

describe('getModelStorageInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports backend "indexeddb" when caches is undefined', async () => {
    vi.stubGlobal('caches', undefined);

    const info = await getModelStorageInfo();

    expect(info.backend).toBe('indexeddb');
  });

  it('reports backend "cache" when caches is defined', async () => {
    vi.stubGlobal('caches', {});

    const info = await getModelStorageInfo();

    expect(info.backend).toBe('cache');
  });

  it('surfaces usage/quota from navigator.storage.estimate()', async () => {
    vi.stubGlobal('caches', {});
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 123456, quota: 999999 }),
      },
    });

    const info = await getModelStorageInfo();

    expect(info.usageBytes).toBe(123456);
    expect(info.quotaBytes).toBe(999999);
  });

  it('omits usage/quota without throwing when estimate() throws', async () => {
    vi.stubGlobal('caches', {});
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });

    await expect(getModelStorageInfo()).resolves.toEqual(
      expect.not.objectContaining({ usageBytes: expect.anything() })
    );
  });

  it('omits usage/quota when navigator.storage is entirely absent', async () => {
    vi.stubGlobal('caches', {});
    vi.stubGlobal('navigator', {});

    const info = await getModelStorageInfo();

    expect(info.usageBytes).toBeUndefined();
    expect(info.quotaBytes).toBeUndefined();
    expect(info.persisted).toBeUndefined();
  });

  it('surfaces persisted() result', async () => {
    vi.stubGlobal('caches', {});
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(true),
      },
    });

    const info = await getModelStorageInfo();

    expect(info.persisted).toBe(true);
  });

  it('surfaces osPath when window.electronPaths.getUserDataPath is present', async () => {
    vi.stubGlobal('caches', {});
    vi.stubGlobal('navigator', {});
    (window as unknown as { electronPaths?: { getUserDataPath: () => Promise<string> } }).electronPaths = {
      getUserDataPath: vi.fn().mockResolvedValue('/Users/test/Library/Application Support/zmNinjaNg'),
    };

    const info = await getModelStorageInfo();

    expect(info.osPath).toBe('/Users/test/Library/Application Support/zmNinjaNg');

    delete (window as unknown as { electronPaths?: unknown }).electronPaths;
  });

  it('leaves osPath undefined when window.electronPaths is absent', async () => {
    vi.stubGlobal('caches', {});
    vi.stubGlobal('navigator', {});
    delete (window as unknown as { electronPaths?: unknown }).electronPaths;

    const info = await getModelStorageInfo();

    expect(info.osPath).toBeUndefined();
  });
});

describe('formatStorageBytes', () => {
  it('formats zero', () => {
    expect(formatStorageBytes(0)).toBe('0 B');
  });

  it('formats bytes below 1KB with no decimal', () => {
    expect(formatStorageBytes(512)).toBe('512 B');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatStorageBytes(500 * 1024 * 1024)).toBe('500.0 MB');
  });

  it('formats gigabytes with one decimal', () => {
    expect(formatStorageBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});
