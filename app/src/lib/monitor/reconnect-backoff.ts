/**
 * When a dropped MJPEG stream tries again.
 *
 * The ordinary schedule doubles from 1s to a 15s ceiling, which suits the
 * failure it was written for: a server that restarted or a network that went
 * away, where trying harder achieves nothing.
 *
 * A failure in the first seconds of a stream's life usually means something
 * else. A profile switch quits every stream of the outgoing profile and then
 * opens a screenful for the incoming one; ZM answers 503 while its streaming
 * daemon is still saturated, and the quits it has not answered yet are exactly
 * the processes holding those slots (see cmdQuitTimeoutSeconds - the switch
 * gives up on the reply, not on the quit). Those slots free within a few
 * seconds. Climbing an exponential curve through that window means a tile
 * waits out an 8 or 15 second delay for a server that recovered at 4 - which
 * is why a switch could leave a wall of monitors blank for twenty seconds and
 * changing screens "fixed" it, by remounting past the pending timer.
 *
 * So for a short opening window a stream retries at a flat, quick interval,
 * and those tries do not spend the give-up budget. After the window the
 * ordinary curve takes over from the beginning, so a genuinely dead server
 * still gets the same patient treatment and the same eventual give-up.
 */

import { ZM_INTEGRATION } from '../zmninja-ng-constants';

export interface ReconnectPlan {
  delayMs: number;
  /**
   * Whether this attempt spends one of the give-up budget. Early tries do not:
   * a handful of cheap requests while a server frees slots should not use up
   * the allowance meant for a server that is actually gone.
   */
  countsTowardCap: boolean;
}

/**
 * @param attempt   Attempts already counted against the cap.
 * @param streamAgeMs How long this stream has been trying, from its first URL.
 */
export function planReconnect(attempt: number, streamAgeMs: number): ReconnectPlan {
  if (streamAgeMs < ZM_INTEGRATION.mjpegEarlyRetryWindowMs) {
    return { delayMs: ZM_INTEGRATION.mjpegEarlyRetryDelayMs, countsTowardCap: false };
  }

  return {
    delayMs: Math.min(
      ZM_INTEGRATION.mjpegReconnectBaseDelayMs * 2 ** attempt,
      ZM_INTEGRATION.mjpegReconnectMaxDelayMs,
    ),
    countsTowardCap: true,
  };
}
