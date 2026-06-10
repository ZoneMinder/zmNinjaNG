import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendDelayedCmdQuit, cancelPendingQuit } from '../zms-quit';
import { ZM_INTEGRATION } from '../zmninja-ng-constants';

const httpGetMock = vi.fn().mockResolvedValue({ data: '' });

vi.mock('../http', () => ({
  httpGet: (...args: unknown[]) => httpGetMock(...args),
}));

vi.mock('../logger', () => ({
  log: {
    zmsEventPlayer: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

describe('zms-quit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    httpGetMock.mockClear();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('sends CMD_QUIT after the grace delay with the given timeout', () => {
    sendDelayedCmdQuit('https://zm.test/quit', 'conn1', { timeoutMs: 15000 });

    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs - 1);
    expect(httpGetMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(httpGetMock).toHaveBeenCalledTimes(1);
    expect(httpGetMock).toHaveBeenCalledWith('https://zm.test/quit', { timeoutMs: 15000 });
  });

  it('cancelPendingQuit cancels a pending quit and reports it', () => {
    sendDelayedCmdQuit('https://zm.test/quit', 'conn2');

    expect(cancelPendingQuit('conn2')).toBe(true);

    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);
    expect(httpGetMock).not.toHaveBeenCalled();
  });

  it('cancelPendingQuit returns false when nothing is pending', () => {
    expect(cancelPendingQuit('conn-none')).toBe(false);
  });

  it('rescheduling for the same connkey replaces the prior timer', () => {
    sendDelayedCmdQuit('https://zm.test/quit-a', 'conn3');
    sendDelayedCmdQuit('https://zm.test/quit-b', 'conn3');

    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);
    expect(httpGetMock).toHaveBeenCalledTimes(1);
    expect(httpGetMock.mock.calls[0][0]).toBe('https://zm.test/quit-b');
  });
});
