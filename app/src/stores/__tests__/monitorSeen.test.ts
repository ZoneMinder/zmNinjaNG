import { describe, it, expect, beforeEach } from 'vitest';
import { useMonitorSeenStore } from '../monitorSeen';

const P1 = 'profile-1';
const P2 = 'profile-2';

describe('useMonitorSeenStore', () => {
  beforeEach(() => {
    useMonitorSeenStore.setState({ profileWatermarks: {} });
  });

  it('reports no watermark for a monitor it has never seen', () => {
    const { hasWatermark, getWatermark } = useMonitorSeenStore.getState();
    expect(hasWatermark(P1, '1')).toBe(false);
    expect(getWatermark(P1, '1')).toBeNull();
  });

  it('seeds a monitor with the newest event timestamp', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    const { hasWatermark, getWatermark } = useMonitorSeenStore.getState();
    expect(hasWatermark(P1, '1')).toBe(true);
    expect(getWatermark(P1, '1')).toBe('2026-07-09 14:26:47');
  });

  it('distinguishes "seeded with no events" from "never seeded"', () => {
    useMonitorSeenStore.getState().seed(P1, '1', null);
    const { hasWatermark, getWatermark } = useMonitorSeenStore.getState();
    // Seeded, so no badge on first sight. Watermark is null, so the count
    // query runs unfiltered and the first event ever recorded reads as new.
    expect(hasWatermark(P1, '1')).toBe(true);
    expect(getWatermark(P1, '1')).toBeNull();
  });

  it('does not re-seed a monitor that already has a watermark', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-01 00:00:00');
  });

  it('does not re-seed a monitor whose watermark is null', () => {
    // null means "seeded while this monitor had no events". Re-seeding it with
    // a real timestamp would mark its whole history as already seen.
    useMonitorSeenStore.getState().seed(P1, '1', null);
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBeNull();
    expect(useMonitorSeenStore.getState().hasWatermark(P1, '1')).toBe(true);
  });

  it('markSeen advances the watermark', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().markSeen(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-09 14:26:47');
  });

  it('markSeen with no newest event is a no-op', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().markSeen(P1, '1', null);
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-01 00:00:00');
  });

  it('scopes watermarks per profile', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().hasWatermark(P2, '1')).toBe(false);

    useMonitorSeenStore.getState().seed(P2, '1', '2026-07-05 09:00:00');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P2, '1')).toBe('2026-07-05 09:00:00');
  });

  it('clearProfile drops only that profile', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    useMonitorSeenStore.getState().seed(P2, '1', '2026-07-05 09:00:00');
    useMonitorSeenStore.getState().clearProfile(P1);
    expect(useMonitorSeenStore.getState().hasWatermark(P1, '1')).toBe(false);
    expect(useMonitorSeenStore.getState().hasWatermark(P2, '1')).toBe(true);
  });
});
