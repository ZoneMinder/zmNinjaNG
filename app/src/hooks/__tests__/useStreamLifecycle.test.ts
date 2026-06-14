/**
 * useStreamLifecycle Hook Tests
 *
 * Tests connKey generation, CMD_QUIT dispatch, media element cleanup, and force-regenerate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { useStreamLifecycle } from '../useStreamLifecycle';
import { quitAllActiveStreams } from '../../lib/active-streams';

// Mock logger
vi.mock('../../lib/logger', () => ({
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
  // log.dedupe runs the callback unconditionally in tests so we don't have
  // to model the throttle window; the callback receives an empty suffix.
  log: {
    dedupe: (_key: string, _windowMs: number, emit: (suffix: string) => void) => emit(''),
  },
}));

// Mock HTTP client
const mockHttpGet = vi.fn().mockResolvedValue({});
vi.mock('../../lib/http', () => ({
  httpGet: (...args: unknown[]) => mockHttpGet(...args),
}));

// Mock url-builder
vi.mock('../../lib/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: string, connkey: string) =>
    `${portalUrl}/control?command=${command}&connkey=${connkey}`,
}));

// Mock ZMS constants
vi.mock('../../lib/zm-constants', () => ({
  ZMS_COMMANDS: { cmdQuit: 'quit' },
}));

// Mock monitor store
const mockRegenerateConnKey = vi.fn();
const mockClearConnKey = vi.fn();
let nextConnKey = 1001;
let mockConnKeys: Record<string, number> = {};

vi.mock('../../stores/monitors', () => ({
  useMonitorStore: vi.fn(),
}));

import { useMonitorStore } from '../../stores/monitors';

function setupMonitorStore() {
  const state = {
    regenerateConnKey: mockRegenerateConnKey,
    clearConnKey: mockClearConnKey,
    connKeys: mockConnKeys,
    getConnKey: vi.fn(),
  };

  vi.mocked(useMonitorStore).mockImplementation((selector) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (selector as (s: any) => unknown)(state);
  });
  (useMonitorStore as unknown as { getState: () => typeof state }).getState = () => state;

  mockRegenerateConnKey.mockImplementation((monitorId: string) => {
    const key = nextConnKey++;
    mockConnKeys[monitorId] = key;
    return key;
  });
  mockClearConnKey.mockImplementation((monitorId: string) => {
    delete mockConnKeys[monitorId];
  });
}

const mockLogFn = vi.fn();

function makeMediaRef(element: HTMLImageElement | null = null) {
  return { current: element };
}

const baseOptions = {
  monitorId: '1',
  monitorName: 'Cam 1',
  portalUrl: 'http://zm.local',
  accessToken: 'tok-abc',
  viewMode: 'streaming' as const,
  logFn: mockLogFn,
  apiTimeoutSeconds: 12,
};

describe('useStreamLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextConnKey = 1001;
    mockConnKeys = {};
    setupMonitorStore();
  });

  describe('initial state', () => {
    it('starts with connKey 0 before mount effect runs', () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );
      // connKey should be 0 synchronously before effect
      // After the effect runs it will be non-zero
      expect(typeof result.current.connKey).toBe('number');
    });

    it('generates a connKey on mount when enabled', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      expect(mockRegenerateConnKey).toHaveBeenCalledWith('1');
    });

    it('does not generate connKey when disabled', () => {
      const mediaRef = makeMediaRef();
      renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef, enabled: false }),
      );

      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });

    it('does not generate connKey when monitorId is undefined', () => {
      const mediaRef = makeMediaRef();
      renderHook(() =>
        useStreamLifecycle({ ...baseOptions, monitorId: undefined, mediaRef }),
      );

      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });
  });

  describe('connKey generation', () => {
    it('returns the key produced by regenerateConnKey', async () => {
      mockRegenerateConnKey.mockReturnValue(5555);
      const mediaRef = makeMediaRef();

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(5555);
      });
    });
  });

  describe('forceRegenerate', () => {
    it('returns a new connKey and updates state', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(1001).mockReturnValueOnce(2002);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(1001);
      });

      let newKey: number;
      act(() => {
        newKey = result.current.forceRegenerate();
      });

      await waitFor(() => {
        expect(result.current.connKey).toBe(2002);
      });

      expect(newKey!).toBe(2002);
    });

    it('returns 0 when monitorId is undefined', async () => {
      const mediaRef = makeMediaRef();

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, monitorId: undefined, mediaRef }),
      );

      let returned: number;
      act(() => {
        returned = result.current.forceRegenerate();
      });

      expect(returned!).toBe(0);
    });

    it('does not send CMD_QUIT (force bypasses normal quit)', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(1001).mockReturnValueOnce(2002);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(1001);
      });

      mockHttpGet.mockClear();

      act(() => {
        result.current.forceRegenerate();
      });

      // forceRegenerate should not fire a CMD_QUIT request
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('sends CMD_QUIT for the previous connkey when killPrevious is set', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(1001).mockReturnValueOnce(2002);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(1001);
      });

      mockHttpGet.mockClear();

      act(() => {
        result.current.forceRegenerate({ killPrevious: true });
      });

      // The old connkey (1001) is quit before minting the new one.
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('connkey=1001'),
        expect.objectContaining({ timeoutMs: 12000 }),
      );
    });
  });

  describe('releaseConnection', () => {
    it('sends CMD_QUIT for the current connkey and clears the stored key', async () => {
      const mediaRef = makeMediaRef();

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const activeKey = result.current.connKey;
      expect(mockConnKeys['1']).toBe(activeKey);

      mockHttpGet.mockClear();

      act(() => {
        result.current.releaseConnection();
      });

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(`connkey=${activeKey}`),
        expect.objectContaining({ timeoutMs: 12000 }),
      );
      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();
    });

    it('is a no-op in snapshot mode', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(4004);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(4004);
      });

      mockHttpGet.mockClear();

      act(() => {
        result.current.releaseConnection();
      });

      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(mockClearConnKey).not.toHaveBeenCalled();
    });

    it('does not re-quit the released key on a later forceRegenerate', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValueOnce(5005).mockReturnValueOnce(6006);

      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).toBe(5005);
      });

      act(() => {
        result.current.releaseConnection();
      });

      mockHttpGet.mockClear();

      // The released key (5005) must not be quit again; prevConnKeyRef was reset.
      act(() => {
        result.current.forceRegenerate({ killPrevious: true });
      });

      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });

  describe('cleanup on unmount', () => {
    it('sends CMD_QUIT in streaming mode on unmount', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(7777);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      // CMD_QUIT should be sent for the active connKey
      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining('connkey=7777'),
          expect.objectContaining({ timeoutMs: 12000 }),
        );
      });
    });

    it('does not send CMD_QUIT in snapshot mode on unmount', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(8888);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      mockHttpGet.mockClear();
      unmount();

      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('does not send CMD_QUIT when connKey is still 0', () => {
      // Keep connKey at 0 by having regenerate return 0
      mockRegenerateConnKey.mockReturnValue(0);
      const mediaRef = makeMediaRef();

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      unmount();

      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('removes the media element src on unmount to abort the stream', async () => {
      const imgElement = document.createElement('img');
      imgElement.src = 'http://zm.local/cgi-bin/nph-zms?mode=jpeg&connkey=9999';
      const mediaRef = { current: imgElement };
      mockRegenerateConnKey.mockReturnValue(9999);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      // src attribute is removed (not set to ''), which aborts the in-flight
      // nph-zms connection and frees the browser connection slot.
      expect(imgElement.hasAttribute('src')).toBe(false);
    });

    it('clears the stored connkey on unmount in streaming mode', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      expect(mockConnKeys['1']).toBe(result.current.connKey);

      unmount();

      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();
    });

    it('does not clear the stored connkey when the store holds a newer key', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      // Another mount of the same monitor regenerated the key after this
      // instance's last render. The cleanup must not remove the newer key.
      mockConnKeys['1'] = result.current.connKey + 1;

      unmount();

      expect(mockClearConnKey).not.toHaveBeenCalled();
      expect(mockConnKeys['1']).toBe(result.current.connKey + 1);
    });

    it('does not clear the stored connkey in snapshot mode', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      unmount();

      expect(mockClearConnKey).not.toHaveBeenCalled();
    });

    it('generates a fresh connkey on remount after the previous key was cleared', async () => {
      const mediaRef = makeMediaRef();

      const first = renderHook(() => useStreamLifecycle({ ...baseOptions, mediaRef }));
      await waitFor(() => {
        expect(first.result.current.connKey).not.toBe(0);
      });
      const oldKey = first.result.current.connKey;

      first.unmount();
      expect(mockConnKeys['1']).toBeUndefined();

      const second = renderHook(() => useStreamLifecycle({ ...baseOptions, mediaRef }));
      await waitFor(() => {
        expect(second.result.current.connKey).not.toBe(0);
      });

      expect(second.result.current.connKey).not.toBe(oldKey);
      expect(mockConnKeys['1']).toBe(second.result.current.connKey);
      second.unmount();
    });

    it('StrictMode double-mount does not clear the active connkey', async () => {
      const mediaRef = makeMediaRef();

      const { result, unmount } = renderHook(
        () => useStreamLifecycle({ ...baseOptions, mediaRef }),
        { wrapper: StrictMode },
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      // The throwaway-mount cleanup ran with connKey 0 and must not have
      // cleared the key the surviving mount is using.
      expect(mockClearConnKey).not.toHaveBeenCalled();
      expect(mockConnKeys['1']).toBe(result.current.connKey);

      const activeKey = result.current.connKey;
      unmount();

      expect(mockClearConnKey).toHaveBeenCalledWith('1');
      expect(mockConnKeys['1']).toBeUndefined();

      // The cleared key is the one that was quit on unmount.
      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining(`connkey=${activeKey}`),
          expect.objectContaining({ timeoutMs: 12000 }),
        );
      });
    });

    it('skips media cleanup when mediaRef.current is null', async () => {
      const mediaRef = makeMediaRef(null);
      mockRegenerateConnKey.mockReturnValue(1111);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('cleanup params tracking', () => {
    it('sends CMD_QUIT with correct portalUrl on unmount', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(4444);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({
          ...baseOptions,
          portalUrl: 'http://my-zm-server',
          mediaRef,
        }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockHttpGet).toHaveBeenCalledWith(
          expect.stringContaining('http://my-zm-server'),
          expect.objectContaining({ timeoutMs: 12000 }),
        );
      });
    });

    it('skips CMD_QUIT when portalUrl is undefined', async () => {
      const mediaRef = makeMediaRef();
      mockRegenerateConnKey.mockReturnValue(5555);

      const { unmount } = renderHook(() =>
        useStreamLifecycle({
          ...baseOptions,
          portalUrl: undefined,
          mediaRef,
        }),
      );

      await waitFor(() => {
        expect(mockRegenerateConnKey).toHaveBeenCalled();
      });

      unmount();

      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });

  describe('enabled flag', () => {
    it('does not generate connKey when enabled is false', () => {
      const mediaRef = makeMediaRef();
      renderHook(() =>
        useStreamLifecycle({ ...baseOptions, enabled: false, mediaRef }),
      );

      expect(mockRegenerateConnKey).not.toHaveBeenCalled();
    });

    it('defaults to enabled when enabled is omitted', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
    });
  });

  describe('profile-switch teardown registry', () => {
    it('registers a teardown that quits the stream, and unregisters on unmount', async () => {
      const mediaRef = makeMediaRef();
      const { result, unmount } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });
      const activeKey = result.current.connKey;

      mockHttpGet.mockClear();
      // A profile switch quits all registered streams before tearing down.
      await quitAllActiveStreams();
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(`connkey=${activeKey}`),
        expect.objectContaining({ timeoutMs: 12000 }),
      );

      unmount();
      mockHttpGet.mockClear();
      // After unmount the tile is unregistered, so a later switch ignores it.
      await quitAllActiveStreams();
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('does not register a teardown in snapshot mode', async () => {
      const mediaRef = makeMediaRef();
      const { result } = renderHook(() =>
        useStreamLifecycle({ ...baseOptions, viewMode: 'snapshot', mediaRef }),
      );

      await waitFor(() => {
        expect(result.current.connKey).not.toBe(0);
      });

      mockHttpGet.mockClear();
      await quitAllActiveStreams();
      // Snapshot mode never sends CMD_QUIT.
      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });
});
