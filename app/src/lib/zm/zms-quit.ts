/**
 * Delayed CMD_QUIT dispatch for zms streams.
 *
 * Quits are scheduled after a short grace delay and tracked in a
 * module-level map keyed by connkey. A remount that reuses the connkey
 * (React StrictMode's dev double-mount) cancels the pending quit instead
 * of killing a stream the surviving mount is still using. A fresh mount
 * (such as a new hover) generates a new connkey, so its cancel never
 * matches and the abandoned stream's quit still fires.
 */

import { httpGet } from '../http';
import { log, LogLevel } from '../logger';
import { ZM_INTEGRATION } from '../zmninja-ng-constants';

const pendingQuits = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Cancel a pending CMD_QUIT for a connkey.
 *
 * @returns true if a quit was pending and got cancelled
 */
export function cancelPendingQuit(connkey: string): boolean {
  const pending = pendingQuits.get(connkey);
  if (pending === undefined) return false;
  clearTimeout(pending);
  pendingQuits.delete(connkey);
  return true;
}

/**
 * Schedule a fire-and-forget CMD_QUIT after a grace delay
 * (ZM_INTEGRATION.cmdQuitGraceMs). Replaces any quit already pending
 * for the same connkey. Errors are logged at DEBUG; the connection may
 * already be closed.
 *
 * @param controlUrl - CMD_QUIT control URL from getZmsControlUrl
 * @param connkey - Connection key the quit is for
 * @param options.timeoutMs - HTTP timeout for the quit request, so teardown
 *   against an unreachable server cannot hang
 * @param options.logContext - Extra fields for the log lines
 */
export function sendDelayedCmdQuit(
  controlUrl: string,
  connkey: string,
  options: { timeoutMs?: number; logContext?: Record<string, unknown> } = {},
): void {
  const { timeoutMs, logContext } = options;
  cancelPendingQuit(connkey);
  const timerId = setTimeout(() => {
    pendingQuits.delete(connkey);
    log.zmsEventPlayer('Sending CMD_QUIT', LogLevel.DEBUG, { connkey, ...logContext });
    // Fire-and-forget: this timer intentionally fires after teardown/unmount,
    // so it must never surface an unhandled error. Call httpGet synchronously
    // (callers/tests rely on that), then guard the result: Promise.resolve(p)
    // returns p itself for a real promise, so a rejection is still caught here,
    // while a non-promise return (e.g. undefined from a reset mock in tests)
    // resolves to a no-op instead of throwing on `.catch`.
    Promise.resolve(httpGet(controlUrl, { timeoutMs })).catch((err) => {
      log.zmsEventPlayer('CMD_QUIT failed', LogLevel.DEBUG, {
        connkey,
        error: String(err),
        ...logContext,
      });
    });
  }, ZM_INTEGRATION.cmdQuitGraceMs);
  pendingQuits.set(connkey, timerId);
}
