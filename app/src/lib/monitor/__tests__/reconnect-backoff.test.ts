import { describe, it, expect } from 'vitest';
import { planReconnect } from '../reconnect-backoff';
import { ZM_INTEGRATION } from '../../zmninja-ng-constants';

const EARLY = ZM_INTEGRATION.mjpegEarlyRetryWindowMs;

describe('planReconnect', () => {
  it('retries quickly while a stream is still young', () => {
    // A switch opens a screenful of streams into a server still releasing the
    // outgoing profile's slots; those come back within seconds.
    expect(planReconnect(0, 0).delayMs).toBe(ZM_INTEGRATION.mjpegEarlyRetryDelayMs);
    expect(planReconnect(3, EARLY - 1).delayMs).toBe(ZM_INTEGRATION.mjpegEarlyRetryDelayMs);
  });

  it('does not spend the give-up budget on those early tries', () => {
    expect(planReconnect(0, 0).countsTowardCap).toBe(false);
    // Otherwise a 2s cadence would burn all six attempts inside the window and
    // give up on a server that was about to answer.
    expect(planReconnect(5, EARLY - 1).countsTowardCap).toBe(false);
  });

  it('falls back to the patient curve once the window closes', () => {
    expect(planReconnect(0, EARLY).delayMs).toBe(ZM_INTEGRATION.mjpegReconnectBaseDelayMs);
    expect(planReconnect(3, EARLY).delayMs).toBe(ZM_INTEGRATION.mjpegReconnectBaseDelayMs * 8);
    expect(planReconnect(0, EARLY).countsTowardCap).toBe(true);
  });

  it('never waits longer than the ceiling', () => {
    expect(planReconnect(20, EARLY + 60_000).delayMs).toBe(
      ZM_INTEGRATION.mjpegReconnectMaxDelayMs,
    );
  });

  it('keeps the early lane quicker than the curve it replaces', () => {
    // The point of the window: retrying sooner than the ordinary schedule
    // would have at the same attempt count.
    const early = planReconnect(3, 0).delayMs;
    const ordinary = planReconnect(3, EARLY).delayMs;
    expect(early).toBeLessThan(ordinary);
  });
});
