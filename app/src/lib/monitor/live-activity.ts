/**
 * Which monitors the Live Activity page shows, and for how long.
 *
 * A monitor enters the list when ZoneMinder reports it alarming, and leaves
 * only after `dwellMs` of continuous non-alarming state. Any fresh alarm
 * inside that window resets the timer.
 *
 * The dwell window is not cosmetic. Each entry and exit mounts or unmounts a
 * MontageMonitor, and useStreamLifecycle mints a ZMS connection key on mount
 * and sends CMD_QUIT on unmount, so a monitor that flickers in and out
 * thrashes nph-zms processes on the server.
 *
 * Order is first-entered ascending and is never re-sorted while the list is
 * non-empty: a list that reorders under a user's finger loses them the tile
 * they were about to tap.
 *
 * Pure on (previous, states, now, dwellMs) so the whole policy is testable
 * without React, fake timers, or a query client.
 */

import { isAlarmingState, type MonitorAlarmState } from './alarm-state';

export interface ActiveMonitorEntry {
  monitorId: string;
  /** Latest reported state, used for the tile label. */
  state: MonitorAlarmState;
  /** When this monitor first entered the list. Fixes its position. */
  enteredAt: number;
  /** When it was last actually alarming. The dwell window runs from here. */
  lastAlarmingAt: number;
  /** How many separate alarms it has had while resident. */
  alarmCount: number;
  /** True while it is resident but no longer alarming. */
  isCooling: boolean;
}

function sameEntry(a: ActiveMonitorEntry, b: ActiveMonitorEntry): boolean {
  return (
    a.monitorId === b.monitorId &&
    a.state === b.state &&
    a.enteredAt === b.enteredAt &&
    a.lastAlarmingAt === b.lastAlarmingAt &&
    a.alarmCount === b.alarmCount &&
    a.isCooling === b.isCooling
  );
}

export function reduceActiveMonitors(
  previous: ActiveMonitorEntry[],
  states: Record<string, MonitorAlarmState>,
  now: number,
  dwellMs: number
): ActiveMonitorEntry[] {
  const next: ActiveMonitorEntry[] = [];

  // Existing entries first, in their existing order, so positions never shift.
  for (const entry of previous) {
    const state = states[entry.monitorId];

    // A monitor that vanished from the poll set (ignored, deleted, filtered
    // out) leaves immediately rather than lingering with a stale state.
    if (state === undefined) continue;

    const alarming = isAlarmingState(state);

    if (alarming) {
      // A fresh alarm is one that starts while the entry was cooling.
      const isFreshAlarm = entry.isCooling;
      next.push({
        ...entry,
        state,
        lastAlarmingAt: now,
        alarmCount: entry.alarmCount + (isFreshAlarm ? 1 : 0),
        isCooling: false,
      });
      continue;
    }

    // Not alarming: keep it until the dwell window from its last alarm closes.
    if (now - entry.lastAlarmingAt > dwellMs) continue;

    next.push({ ...entry, state, isCooling: true });
  }

  // Then monitors that are newly alarming, appended in the order the states
  // map presents them.
  const resident = new Set(next.map((e) => e.monitorId));
  for (const [monitorId, state] of Object.entries(states)) {
    if (resident.has(monitorId)) continue;
    if (!isAlarmingState(state)) continue;
    next.push({
      monitorId,
      state,
      enteredAt: now,
      lastAlarmingAt: now,
      alarmCount: 1,
      isCooling: false,
    });
  }

  // Preserve reference identity when nothing moved, so React Query poll ticks
  // that change nothing do not re-render every tile.
  if (
    next.length === previous.length &&
    next.every((entry, i) => sameEntry(entry, previous[i]))
  ) {
    return previous;
  }

  return next;
}

/**
 * Overlay websocket/push alarm hints onto polled state.
 *
 * A push event arrives seconds before the next poll tick would notice, so a
 * hinted monitor is treated as alarming immediately; the next poll either
 * confirms it or lets the dwell window expire it normally.
 *
 * Hints only ever promote a monitor that is already being polled: this only
 * iterates the existing keys of `states`, so a hint for a monitor the page is
 * not watching (page-ignored, or excluded profile-wide) is dropped rather
 * than resurrecting it and leaking the ignore list.
 */
export function applyLiveAlarmHints(
  states: Record<string, MonitorAlarmState>,
  hintedMonitorIds: Set<string>
): Record<string, MonitorAlarmState> {
  let changed = false;
  const next: Record<string, MonitorAlarmState> = {};

  for (const [monitorId, state] of Object.entries(states)) {
    if (hintedMonitorIds.has(monitorId) && !isAlarmingState(state)) {
      next[monitorId] = 'alarm';
      changed = true;
    } else {
      next[monitorId] = state;
    }
  }

  return changed ? next : states;
}

export function capActiveMonitors(
  entries: ActiveMonitorEntry[],
  maxTiles: number
): { visible: ActiveMonitorEntry[]; overflowCount: number } {
  if (entries.length <= maxTiles) {
    return { visible: entries, overflowCount: 0 };
  }
  return {
    visible: entries.slice(0, maxTiles),
    overflowCount: entries.length - maxTiles,
  };
}
