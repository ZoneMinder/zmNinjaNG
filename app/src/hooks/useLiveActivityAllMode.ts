/**
 * All-mode data for the Live Activity page (refs #337, #341): every scope
 * profile's watched monitors, alarm fanout and live-hint causes, keyed by
 * monitorCacheKey(profileId, monitorId) so two servers sharing a raw
 * monitor id never collide.
 *
 * Extracted out of LiveActivity.tsx (C2 - the page file had grown past the
 * 400-line guideline once All mode was added). Single mode is entirely
 * unaffected: LiveActivity.tsx keeps its own useAlarmStates/useQuery path
 * unchanged and this hook simply produces empty/disabled results while
 * `isAllMode` is false, at the cost of the cheap selectors below still
 * running (useProfileScope, the settings map subscription) - no network
 * fanout happens until enabled.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileScope } from './useProfileScope';
import { useScopedMonitors } from './useScopedMonitors';
import { useScopedAlarmStates, type ScopedAlarmRef } from './useAlarmStates';
import { useSettingsStore, mergeProfileSettings } from '../stores/settings';
import { monitorCacheKey } from '../stores/monitors';
import { useNotificationStore } from '../stores/notifications';
import { capWatchedRoundRobin } from '../lib/monitor/live-activity';
import { LIVE_ACTIVITY } from '../lib/zmninja-ng-constants';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';
import type { Monitor, MonitorStatus, Profile, ProfileId } from '../api/types';
import type { ProfileError } from '../api/scoped-types';

/** One tile's render data, shared with LiveActivity.tsx's single-mode map so
 *  both feed the same tile lookup shape. */
export interface LiveActivityMonitorEntry {
  Monitor: Monitor;
  Monitor_Status: MonitorStatus | undefined;
  /** Set only in All mode. */
  profileId?: ProfileId;
  profileChip?: string;
}

interface UseLiveActivityAllModeReturn {
  /** Keyed by monitorCacheKey(profileId, monitorId). Empty in single mode. */
  monitorsById: Map<string, LiveActivityMonitorEntry>;
  profilesById: Map<ProfileId, Profile>;
  profileErrors: ProfileError[];
  isMonitorsLoading: boolean;
  /** Total (profile, monitor) pairs watched, after the round-robin cap. */
  watchedCount: number;
  /** How many watched pairs the cap dropped, for the overflow notice. */
  watchOverflowCount: number;
  /** Keyed by monitorCacheKey(profileId, monitorId). */
  states: Record<string, MonitorAlarmState>;
  isAlarmsLoading: boolean;
  alarmError: Error | null;
  /** Keyed by monitorCacheKey(profileId, monitorId). */
  recentCauses: ReadonlyMap<string, string>;
}

export function useLiveActivityAllMode(
  isAllMode: boolean,
  dwellMs: number,
  configuredPollIntervalMs: number
): UseLiveActivityAllModeReturn {
  const scope = useProfileScope();
  const {
    monitors: scopedMonitors,
    errors: profileErrors,
    isLoading: isMonitorsLoading,
  } = useScopedMonitors({ enabled: isAllMode });

  const profilesById = useMemo(
    () => new Map((scope?.profiles ?? []).map((p) => [p.id, p])),
    [scope?.profiles]
  );

  const monitorsById = useMemo(() => {
    const map = new Map<string, LiveActivityMonitorEntry>();
    if (!isAllMode) return map;
    for (const { profileId, profileName, item } of scopedMonitors) {
      map.set(monitorCacheKey(profileId, item.Monitor.Id), {
        Monitor: item.Monitor,
        Monitor_Status: item.Monitor_Status,
        profileId,
        profileChip: profileName,
      });
    }
    return map;
  }, [isAllMode, scopedMonitors]);

  // Raw record select (not a per-profile selector), same discipline as
  // useNotificationAllModeToasts' profileSettings subscription: every
  // profile's OWN liveActivityIgnoredMonitorIds is a per-server data
  // preference, never the shared ALL-bucket settings the page's poll/dwell/
  // tiles controls use.
  const profileSettingsMap = useSettingsStore((s) => s.profileSettings);

  // Grouped by owning profile (not a flat list) so the round-robin cap below
  // can draw evenly from each profile instead of exhausting the first one.
  const watchedGroups = useMemo(() => {
    if (!isAllMode) return [];
    const byProfile = new Map<ProfileId, ScopedAlarmRef[]>();
    for (const { profileId, item } of scopedMonitors) {
      const ignored = mergeProfileSettings(profileSettingsMap[profileId]).liveActivityIgnoredMonitorIds;
      if (ignored.includes(item.Monitor.Id)) continue;
      const list = byProfile.get(profileId) ?? [];
      list.push({ profileId, monitorId: item.Monitor.Id });
      byProfile.set(profileId, list);
    }
    return Array.from(byProfile.values());
  }, [isAllMode, scopedMonitors, profileSettingsMap]);

  // GUARDRAIL: total watched cap, round-robin across profiles - the alarm
  // endpoint is per-monitor, so without this an All mode with many
  // profiles/monitors could fan out dozens of concurrent polls.
  const { watched: watchedPairs, overflowCount: watchOverflowCount } = useMemo(
    () => capWatchedRoundRobin(watchedGroups, LIVE_ACTIVITY.allModeMaxWatched),
    [watchedGroups]
  );

  // GUARDRAIL: poll floor. Live hints (below) carry the fast path when a
  // profile's connection is Live; polling only confirms, so All mode does
  // not need single mode's tighter floor while fanning its poll out across
  // every scope profile at once.
  const allModePollIntervalMs = Math.max(configuredPollIntervalMs, LIVE_ACTIVITY.allModePollFloorSeconds * 1000);

  const { states, isLoading: isAlarmsLoading, error: alarmError } = useScopedAlarmStates(watchedPairs, {
    enabled: isAllMode,
    pollIntervalMs: allModePollIntervalMs,
  });

  // Live-hint accelerant, generalized across every scope profile and keyed
  // by monitorCacheKey so an event for profile B's monitor "3" can never
  // promote profile A's own monitor "3". Mirrors useNotificationAllModeToasts'
  // raw-slice discipline: reads the store's actual per-profile event arrays
  // rather than a derived value, so useShallow can dedupe repeated empty
  // snapshots to one reference.
  const scopeProfileIds = useMemo(() => (scope?.profiles ?? []).map((p) => p.id), [scope?.profiles]);
  const recentCauses = useNotificationStore(
    useShallow((state) => {
      const causes = new Map<string, string>();
      if (!isAllMode) return causes;
      const cutoff = Date.now() - dwellMs;
      for (const profileId of scopeProfileIds) {
        const events = state.profileEvents[profileId];
        if (!events?.length) continue;
        for (const event of events) {
          if (event.receivedAt < cutoff) continue;
          const key = monitorCacheKey(profileId, String(event.MonitorId));
          if (!causes.has(key)) causes.set(key, event.Cause ?? '');
        }
      }
      return causes;
    })
  );

  return {
    monitorsById,
    profilesById,
    profileErrors,
    isMonitorsLoading,
    watchedCount: watchedPairs.length,
    watchOverflowCount,
    states,
    isAlarmsLoading,
    alarmError,
    recentCauses,
  };
}
