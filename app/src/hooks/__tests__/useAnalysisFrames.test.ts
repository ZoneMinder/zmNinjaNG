/**
 * useAnalysisFrames Hook Tests
 *
 * Covers the two ways CMD_ANALYZE_ON/OFF reaches a running zms process: the
 * user flipping the toggle, and the re-apply that keeps the setting alive
 * across the connkey churn of reconnects, retries, and visibility resumes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalysisFrames } from '../useAnalysisFrames';

vi.mock('../../lib/logger', () => ({
  LogLevel: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  log: {
    monitor: vi.fn(),
    dedupe: (_key: string, _windowMs: number, emit: (suffix: string) => void) => emit(''),
  },
}));

const mockHttpGet = vi.fn().mockResolvedValue({});
vi.mock('../../lib/http', () => ({
  httpGet: (...args: unknown[]) => mockHttpGet(...args),
}));

vi.mock('../../lib/zm/url-builder', () => ({
  getZmsControlUrl: (portalUrl: string, command: number, connkey: string) =>
    `${portalUrl}/control?command=${command}&connkey=${connkey}`,
}));

const BASE = {
  monitorId: '1',
  portalUrl: 'https://zm.test/zm',
  accessToken: 'tok',
  viewMode: 'streaming' as const,
  enabled: true,
  apiTimeoutSeconds: 30,
};

/** The command numbers ZoneMinder defines for the analysis overlay. */
const CMD_ANALYZE_ON = 19;
const CMD_ANALYZE_OFF = 20;

const sentCommands = () => mockHttpGet.mock.calls.map(([url]) => new URL(url as string).searchParams.get('command'));

describe('useAnalysisFrames', () => {
  beforeEach(() => {
    mockHttpGet.mockClear();
  });

  it('sends CMD_ANALYZE_ON for the live connkey when the toggle turns on', async () => {
    const { rerender } = renderHook(
      (props: { showAnalysis: boolean }) =>
        useAnalysisFrames({ ...BASE, connKey: 5001, showAnalysis: props.showAnalysis }),
      { initialProps: { showAnalysis: false } },
    );

    expect(mockHttpGet).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ showAnalysis: true });
    });

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
    const url = new URL(mockHttpGet.mock.calls[0][0] as string);
    expect(url.searchParams.get('command')).toBe(String(CMD_ANALYZE_ON));
    expect(url.searchParams.get('connkey')).toBe('5001');
  });

  it('sends CMD_ANALYZE_OFF when the toggle turns back off', async () => {
    const { rerender } = renderHook(
      (props: { showAnalysis: boolean }) =>
        useAnalysisFrames({ ...BASE, connKey: 5001, showAnalysis: props.showAnalysis }),
      { initialProps: { showAnalysis: false } },
    );

    await act(async () => { rerender({ showAnalysis: true }); });
    await act(async () => { rerender({ showAnalysis: false }); });

    expect(sentCommands()).toEqual([String(CMD_ANALYZE_ON), String(CMD_ANALYZE_OFF)]);
  });

  it('re-applies on the first frame of a new connkey, so a reconnect keeps analysis on', async () => {
    const { result, rerender } = renderHook(
      (props: { connKey: number }) =>
        useAnalysisFrames({ ...BASE, connKey: props.connKey, showAnalysis: true }),
      { initialProps: { connKey: 5001 } },
    );

    // Mount with analysis already on (remembered setting): the command waits for
    // the first frame, which is the only proof zms-<connkey>w.sock exists.
    expect(mockHttpGet).not.toHaveBeenCalled();
    act(() => { result.current.applyOnStreamLoad(); });
    expect(sentCommands()).toEqual([String(CMD_ANALYZE_ON)]);

    // Reconnect: fresh nph-zms process, defaults to analysis off.
    await act(async () => { rerender({ connKey: 5002 }); });
    act(() => { result.current.applyOnStreamLoad(); });

    expect(mockHttpGet).toHaveBeenCalledTimes(2);
    expect(new URL(mockHttpGet.mock.calls[1][0] as string).searchParams.get('connkey')).toBe('5002');
  });

  it('does not resend on every frame of the same connection', () => {
    const { result } = renderHook(() =>
      useAnalysisFrames({ ...BASE, connKey: 5001, showAnalysis: true }),
    );

    act(() => {
      result.current.applyOnStreamLoad();
      result.current.applyOnStreamLoad();
      result.current.applyOnStreamLoad();
    });

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a fresh connection while analysis is off', () => {
    const { result } = renderHook(() =>
      useAnalysisFrames({ ...BASE, connKey: 5001, showAnalysis: false }),
    );

    act(() => { result.current.applyOnStreamLoad(); });

    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('sends nothing in snapshot mode, where zms serves a single image and ignores the frame type', async () => {
    const { result, rerender } = renderHook(
      (props: { showAnalysis: boolean }) =>
        useAnalysisFrames({
          ...BASE,
          viewMode: 'snapshot',
          connKey: 5001,
          showAnalysis: props.showAnalysis,
        }),
      { initialProps: { showAnalysis: false } },
    );

    await act(async () => { rerender({ showAnalysis: true }); });
    act(() => { result.current.applyOnStreamLoad(); });

    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('sends nothing before a connkey has been minted', async () => {
    const { rerender } = renderHook(
      (props: { showAnalysis: boolean }) =>
        useAnalysisFrames({ ...BASE, connKey: 0, showAnalysis: props.showAnalysis }),
      { initialProps: { showAnalysis: false } },
    );

    await act(async () => { rerender({ showAnalysis: true }); });

    expect(mockHttpGet).not.toHaveBeenCalled();
  });
});
