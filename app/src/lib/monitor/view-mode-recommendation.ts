/**
 * Which Streaming Mode suits a server.
 *
 * Continuous MJPEG holds one connection per tile, and a browser or WebView
 * keeps only about six open to one host, so the choice comes down to how many
 * monitors compete for those connections. Multi-port streaming
 * (ZM_MIN_STREAMING_PORT) puts every monitor on its own port, which removes the
 * ceiling no matter how many monitors there are.
 *
 * This is a recommendation, not a policy: bootstrap uses it for the initial
 * value of a new profile, Settings shows it as a hint, and the user's own
 * toggle always wins.
 */

import { STREAMING_MONITOR_LIMIT } from '../zmninja-ng-constants';
import type { ViewMode } from '../../stores/settings';

/** Why a mode is recommended, for the Settings hint. */
export type ViewModeReason = 'few-monitors' | 'multi-port' | 'many-monitors';

export interface ViewModeRecommendation {
  mode: ViewMode;
  reason: ViewModeReason;
}

/**
 * @param monitorCount Monitors the app shows for this server (deleted and
 *   per-profile excluded ones already dropped by getMonitors), or null when
 *   not known yet. Disabled monitors still count: they get a tile, and a tile
 *   on the MJPEG path holds a connection whether or not the camera is up.
 * @param minStreamingPort The effective multi-port base
 *   (`resolveMinStreamingPort`), undefined when multi-port is off.
 */
export function recommendViewMode(
  monitorCount: number | null,
  minStreamingPort: number | undefined,
): ViewModeRecommendation {
  // An unknown count falls through to the multi-port check and then to
  // snapshot, the mode that works on any server size.
  if (monitorCount !== null && monitorCount <= STREAMING_MONITOR_LIMIT) {
    return { mode: 'streaming', reason: 'few-monitors' };
  }
  if (minStreamingPort !== undefined) {
    return { mode: 'streaming', reason: 'multi-port' };
  }
  return { mode: 'snapshot', reason: 'many-monitors' };
}
