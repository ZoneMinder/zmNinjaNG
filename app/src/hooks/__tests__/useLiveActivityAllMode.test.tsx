import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LIVE_ACTIVITY } from '../../lib/zmninja-ng-constants';

// Isolates the poll-floor guardrail (Math.max(configured, allModePollFloorSeconds))
// from the rest of useLiveActivityAllMode's fanout: mocks every dependency and
// spies on what useScopedAlarmStates is actually called with.
const scopedAlarmStatesSpy = vi.hoisted(() =>
  vi.fn((_pairs: unknown, _options: unknown) => ({ states: {}, isLoading: false, error: null }))
);

vi.mock('../useProfileScope', () => ({ useProfileScope: () => null }));
vi.mock('../useScopedMonitors', () => ({
  useScopedMonitors: () => ({ monitors: [], errors: [], isLoading: false, refetchProfile: vi.fn() }),
}));
vi.mock('../useAlarmStates', () => ({ useScopedAlarmStates: scopedAlarmStatesSpy }));
vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (s: { profileSettings: Record<string, unknown> }) => unknown) =>
    selector({ profileSettings: {} }),
  mergeProfileSettings: () => ({ liveActivityIgnoredMonitorIds: [] }),
}));
vi.mock('../../stores/notifications', () => ({
  useNotificationStore: (selector: (s: { profileEvents: Record<string, unknown[]> }) => unknown) =>
    selector({ profileEvents: {} }),
}));

import { useLiveActivityAllMode } from '../useLiveActivityAllMode';

const FLOOR_MS = LIVE_ACTIVITY.allModePollFloorSeconds * 1000;
// Empty resident set: the resident-exemption cap behavior has its own
// coverage (live-activity-cap.test.ts, LiveActivity.test.tsx's re-slice
// test); this file only cares about the poll-floor guardrail.
const emptyActive: never[] = [];

describe('useLiveActivityAllMode poll floor', () => {
  it('clamps a configured interval below the floor up to the floor, in All mode', () => {
    renderHook(() => useLiveActivityAllMode(true, 30_000, 1_000, emptyActive));
    const [, options] = scopedAlarmStatesSpy.mock.calls.at(-1)!;
    expect((options as { pollIntervalMs: number }).pollIntervalMs).toBe(FLOOR_MS);
  });

  it('leaves a configured interval already above the floor untouched, in All mode', () => {
    const above = FLOOR_MS + 5_000;
    renderHook(() => useLiveActivityAllMode(true, 30_000, above, emptyActive));
    const [, options] = scopedAlarmStatesSpy.mock.calls.at(-1)!;
    expect((options as { pollIntervalMs: number }).pollIntervalMs).toBe(above);
  });

  it('still computes the floored value in single mode, but useScopedAlarmStates is disabled so it never polls', () => {
    // The guardrail math runs regardless (it's a cheap Math.max), but `enabled`
    // is what actually gates the fanout: single mode's own pollIntervalMs
    // (used by the page's separate useAlarmStates call) is never touched by
    // this floor at all - this only proves the All-mode fanout itself stays off.
    renderHook(() => useLiveActivityAllMode(false, 30_000, 1_000, emptyActive));
    const [, options] = scopedAlarmStatesSpy.mock.calls.at(-1)!;
    expect((options as { enabled: boolean }).enabled).toBe(false);
  });
});
