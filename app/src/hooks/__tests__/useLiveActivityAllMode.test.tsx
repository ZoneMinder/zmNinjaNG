import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '../../stores/settings';
import type { ProfileSettings } from '../../stores/settings';

// Isolates the two All-mode guardrails (the watched-pair cap and the poll
// floor, both read from the ALL settings bucket) from the rest of
// useLiveActivityAllMode's fanout: mocks every dependency and spies on what
// useScopedAlarmStates is actually called with.
const scopedAlarmStatesSpy = vi.hoisted(() =>
  vi.fn((_pairs: unknown, _options: unknown) => ({ states: {}, isLoading: false, error: null }))
);
const scopedMonitorsSpy = vi.hoisted(() =>
  vi.fn(() => ({ monitors: [] as unknown[], errors: [], isLoading: false, refetchProfile: vi.fn() }))
);
// The ALL bucket the page's guardrails read. Mutable so a test can turn a
// guardrail down and assert the fanout follows the setting rather than the
// constant it used to hardcode.
const allSettings = vi.hoisted(() => ({ current: null as ProfileSettings | null }));

vi.mock('../useProfileScope', () => ({
  useProfileScope: () =>
    allSettings.current
      ? { mode: 'all', profile: null, profiles: [], settings: allSettings.current }
      : null,
}));
vi.mock('../useScopedMonitors', () => ({ useScopedMonitors: () => scopedMonitorsSpy() }));
vi.mock('../useAlarmStates', () => ({ useScopedAlarmStates: scopedAlarmStatesSpy }));
vi.mock('../../stores/notifications', () => ({
  useNotificationStore: (selector: (s: { profileEvents: Record<string, unknown[]> }) => unknown) =>
    selector({ profileEvents: {} }),
}));

import { useLiveActivityAllMode } from '../useLiveActivityAllMode';

const FLOOR_MS = DEFAULT_SETTINGS.allModePollFloorSeconds * 1000;
// Empty resident set: the resident-exemption cap behavior has its own
// coverage (live-activity-cap.test.ts, LiveActivity.test.tsx's re-slice
// test); this file only cares about the two guardrails.
const emptyActive: never[] = [];

const scopedMonitor = (profileId: string, id: string) => ({
  profileId,
  profileName: profileId,
  item: { Monitor: { Id: id, Name: `Monitor ${id}` }, Monitor_Status: undefined },
});

describe('useLiveActivityAllMode guardrails', () => {
  beforeEach(() => {
    allSettings.current = { ...DEFAULT_SETTINGS };
    scopedMonitorsSpy.mockReturnValue({
      monitors: [],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });
  });

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

  it('floors at the seconds the ALL bucket sets, not the shipped default', () => {
    allSettings.current = { ...DEFAULT_SETTINGS, allModePollFloorSeconds: 45 };
    renderHook(() => useLiveActivityAllMode(true, 30_000, 1_000, emptyActive));
    const [, options] = scopedAlarmStatesSpy.mock.calls.at(-1)!;
    expect((options as { pollIntervalMs: number }).pollIntervalMs).toBe(45_000);
  });

  it('still leaves a slower configured interval alone when the floor is raised', () => {
    // The floor clamps the bandwidth-derived interval, it never replaces it:
    // a user who asked for a slow poll keeps the slow poll.
    allSettings.current = { ...DEFAULT_SETTINGS, allModePollFloorSeconds: 20 };
    renderHook(() => useLiveActivityAllMode(true, 30_000, 60_000, emptyActive));
    const [, options] = scopedAlarmStatesSpy.mock.calls.at(-1)!;
    expect((options as { pollIntervalMs: number }).pollIntervalMs).toBe(60_000);
  });

  it('watches only as many pairs as the ALL bucket allows, reporting the rest as overflow', () => {
    allSettings.current = { ...DEFAULT_SETTINGS, allModeMaxWatched: 2 };
    scopedMonitorsSpy.mockReturnValue({
      monitors: [
        scopedMonitor('profile-a', '1'),
        scopedMonitor('profile-a', '2'),
        scopedMonitor('profile-b', '3'),
        scopedMonitor('profile-b', '4'),
        scopedMonitor('profile-b', '5'),
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { result } = renderHook(() => useLiveActivityAllMode(true, 30_000, 30_000, emptyActive));

    expect(result.current.watchedCount).toBe(2);
    expect(result.current.watchOverflowCount).toBe(3);
    const [pairs] = scopedAlarmStatesSpy.mock.calls.at(-1)!;
    expect(pairs).toHaveLength(2);
    // Round-robin: one pair from each server rather than both from the first.
    expect(new Set((pairs as { profileId: string }[]).map((p) => p.profileId)).size).toBe(2);
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
