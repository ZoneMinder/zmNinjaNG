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
 * Order is newest-alarm-episode first, tiebroken by monitor id: the tile a
 * user most likely wants is the camera that just went off, so it belongs at
 * the top of the grid rather than below whatever alarmed earlier. Under the
 * tile cap that also means the newest activity is what survives truncation.
 * Tiles do move when the order changes, which the page softens with a view
 * transition. The id tiebreak keeps two monitors that alarmed in the same poll
 * from swapping places on later renders for no reason.
 *
 * The sort key is the episode start, not the last alarming moment, and that
 * distinction is the whole point. ZoneMinder's own state machine walks a
 * winding-down event through `alarm` -> `alert` -> `tape`/`idle` and back
 * again, so across one event's tail a monitor leaves and rejoins the alarming
 * set every second or two. Sorting on a key restamped from the clock on every
 * pass turned that into a reorder per tick, and every reorder starts a view
 * transition that stops all the tiles painting their live stream for a few
 * hundred milliseconds. Measured over a realistic two-monitor tail driven once
 * a second: 13 reorders in 66 seconds, 11 of them inside a 13-second window.
 * The episode key holds a monitor's slot for as long as it keeps alarming, and
 * `LIVE_ACTIVITY.episodeGraceSeconds` decides how long it has to stay quiet
 * before its next alarm counts as a new episode and moves it back to the top.
 *
 * `lastAlarmingAt` is still restamped on every alarming pass, because the
 * dwell window runs from it; it just no longer decides position.
 *
 * Pure on (previous, states, now, dwellMs) so the whole policy is testable
 * without React, fake timers, or a query client.
 */

import { LIVE_ACTIVITY } from '../zmninja-ng-constants';
import { isAlarmingState, type MonitorAlarmState } from './alarm-state';

const EPISODE_GRACE_MS = LIVE_ACTIVITY.episodeGraceSeconds * 1000;

export interface ActiveMonitorEntry {
  monitorId: string;
  /** Latest reported state, used for the tile label. */
  state: MonitorAlarmState;
  /** When this monitor first entered the list. */
  enteredAt: number;
  /** When it was last actually alarming. The dwell window runs from here. */
  lastAlarmingAt: number;
  /**
   * When its current alarm episode began. The sort order runs from here, and
   * it is deliberately not restamped while an alarm is ongoing or flapping
   * through an event's tail, so a resident monitor holds its slot.
   */
  episodeStartedAt: number;
  /** True while it is resident but no longer alarming. */
  isCooling: boolean;
  /**
   * What ZoneMinder said triggered this episode, when anything said so at
   * all. Only the notification stream carries a cause, so a monitor found by
   * polling alone has none and the tile has to read correctly without it.
   */
  cause?: string;
}

interface ReduceOptions {
  /**
   * Monitors the user has cleared by hand. They are skipped both as residents
   * and as new arrivals: a monitor that is still alarming would otherwise be
   * readmitted on the very next poll, so the control would look broken on the
   * first click. `releaseDismissed` decides when one stops applying.
   */
  dismissed?: ReadonlySet<string>;
  /**
   * Monitor id to the cause of its most recent notification. Consulted when
   * an episode begins and while an entry still has no cause; never used to
   * clear one, because these entries expire on the notification store's
   * schedule rather than the episode's.
   */
  causes?: ReadonlyMap<string, string>;
}

/** Blank and whitespace-only causes read as "not reported". */
function normalizeCause(cause: string | undefined): string | undefined {
  const trimmed = cause?.trim();
  return trimmed ? trimmed : undefined;
}

function sameEntry(a: ActiveMonitorEntry, b: ActiveMonitorEntry): boolean {
  return (
    a.monitorId === b.monitorId &&
    a.state === b.state &&
    a.enteredAt === b.enteredAt &&
    a.lastAlarmingAt === b.lastAlarmingAt &&
    a.episodeStartedAt === b.episodeStartedAt &&
    a.isCooling === b.isCooling &&
    a.cause === b.cause
  );
}

export function reduceActiveMonitors(
  previous: ActiveMonitorEntry[],
  states: Record<string, MonitorAlarmState>,
  now: number,
  dwellMs: number,
  { causes, dismissed }: ReduceOptions = {}
): ActiveMonitorEntry[] {
  const next: ActiveMonitorEntry[] = [];

  // Existing entries first; the sort below decides where they end up.
  for (const entry of previous) {
    if (dismissed?.has(entry.monitorId)) continue;
    const state = states[entry.monitorId];

    // A monitor that vanished from the poll set (ignored, deleted, filtered
    // out) leaves immediately rather than lingering with a stale state.
    if (state === undefined) continue;

    const alarming = isAlarmingState(state);

    if (alarming) {
      // A re-alarm only starts a new episode, and so a new sort position, if
      // the monitor had been quiet long enough that this is not the same event
      // still winding down. A blip back into `alarm` a second after dropping
      // to `tape` is the same episode and must not move the tile.
      const startsNewEpisode =
        entry.isCooling && now - entry.lastAlarmingAt > EPISODE_GRACE_MS;
      const reported = normalizeCause(causes?.get(entry.monitorId));
      next.push({
        ...entry,
        state,
        lastAlarmingAt: now,
        episodeStartedAt: startsNewEpisode ? now : entry.episodeStartedAt,
        isCooling: false,
        // A new episode takes whatever cause is current, even none. An
        // ongoing one keeps what it has, and picks up a cause that arrived
        // after the poll had already found the alarm.
        cause: startsNewEpisode ? reported : (entry.cause ?? reported),
      });
      continue;
    }

    // Not alarming: keep it until the dwell window from its last alarm closes.
    if (now - entry.lastAlarmingAt > dwellMs) continue;

    next.push({ ...entry, state, isCooling: true });
  }

  // Then monitors that are newly alarming.
  const resident = new Set(next.map((e) => e.monitorId));
  for (const [monitorId, state] of Object.entries(states)) {
    if (resident.has(monitorId)) continue;
    if (dismissed?.has(monitorId)) continue;
    if (!isAlarmingState(state)) continue;
    next.push({
      monitorId,
      state,
      enteredAt: now,
      lastAlarmingAt: now,
      episodeStartedAt: now,
      isCooling: false,
      cause: normalizeCause(causes?.get(monitorId)),
    });
  }

  // Newest alarm episode on top. Sorted before the identity check below, so a
  // sort that changes nothing still hands back the previous array.
  next.sort(
    (a, b) =>
      b.episodeStartedAt - a.episodeStartedAt ||
      (a.monitorId < b.monitorId ? -1 : a.monitorId > b.monitorId ? 1 : 0)
  );

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

/**
 * Drop the dismissals that have served their purpose.
 *
 * A dismissal exists to stop a monitor that is still alarming from being
 * readmitted the moment it is cleared. Once that monitor has genuinely gone
 * quiet, or the page has stopped watching it, the dismissal has to go: a
 * later, separate alarm on the same camera is new information and has to show
 * normally. Nothing here readmits anything by itself, because the reducer only
 * ever admits a monitor that is alarming right now.
 *
 * Returns the same set when nothing was released, so the caller can hold it in
 * a ref without handing the reducer a new input on every poll tick.
 */
export function releaseDismissed(
  dismissed: ReadonlySet<string>,
  states: Record<string, MonitorAlarmState>
): ReadonlySet<string> {
  const held = [...dismissed].filter((monitorId) => {
    const state = states[monitorId];
    return state !== undefined && isAlarmingState(state);
  });
  if (held.length === dismissed.size) return dismissed;
  return new Set(held);
}

/**
 * Whether two lists show the same monitors in the same slots.
 *
 * The page animates a reorder and does not animate anything else, so it needs
 * to tell "these tiles moved" from "a tile changed state where it stands".
 */
export function sameMonitorOrder(a: ActiveMonitorEntry[], b: ActiveMonitorEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.monitorId === b[i].monitorId);
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

/**
 * All mode only: caps the total watched set across every profile's own
 * group, distributing the cap round-robin instead of taking the first N in
 * profile order. A profile-order truncation (Montage's stream cap) would let
 * one server with many monitors starve every profile listed after it; here
 * each profile's own monitor list is a `groups` entry, so position 0 from
 * every profile is taken before position 1 from any, and so on, until the
 * cap is reached. Deterministic for a given input order (refs #337, #341).
 */
export function capWatchedRoundRobin<T>(
  groups: T[][],
  maxTotal: number
): { watched: T[]; overflowCount: number } {
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  if (total <= maxTotal) {
    return { watched: groups.flat(), overflowCount: 0 };
  }

  const watched: T[] = [];
  const maxGroupLength = Math.max(0, ...groups.map((group) => group.length));
  for (let pos = 0; pos < maxGroupLength && watched.length < maxTotal; pos++) {
    for (const group of groups) {
      if (watched.length >= maxTotal) break;
      if (pos < group.length) watched.push(group[pos]);
    }
  }

  return { watched, overflowCount: total - watched.length };
}
