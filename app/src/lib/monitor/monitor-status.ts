/**
 * Monitor status utility.
 *
 * Single source of truth for deriving a monitor's run state from its
 * configuration and daemon status. Matches ZoneMinder's own console.js
 * color logic. Works across ZM 1.38+ and older versions.
 */

import type { Monitor, MonitorStatus } from '../../api/types';
import { isZmVersionAtLeast } from '../zm/zm-version';

export type MonitorRunState = 'live' | 'warning' | 'offline' | 'disabled';

const ANALYSIS_FUNCTIONS = new Set(['Modect', 'Mocord', 'Nodect']);

/**
 * Pre-1.38 Functions that write every captured frame to an event, not just the
 * alarmed ones. Mocord is in both this set and ANALYSIS_FUNCTIONS: it records
 * continuously *and* runs motion detection.
 */
const CONTINUOUS_FUNCTIONS = new Set(['Record', 'Mocord']);

function parseFps(fps: string | null | undefined): number {
  return parseFloat(fps ?? '0') || 0;
}

/**
 * Derives a monitor's run state.
 *
 * - "disabled": not configured to capture (Capturing=None / Function=None)
 * - "offline":  configured but daemon not connected or CaptureFPS is 0
 * - "warning":  capturing OK but analysis is enabled and AnalysisFPS is 0
 * - "live":     capturing frames and analysis (if enabled) is running
 */
export function getMonitorRunState(
  monitor: Monitor,
  status: MonitorStatus | undefined,
  zmVersion: string | null,
): MonitorRunState {
  const is138Plus = isZmVersionAtLeast(zmVersion, '1.38.0');

  const isConfigured = is138Plus
    ? monitor.Capturing !== 'None'
    : monitor.Function !== 'None';

  if (!isConfigured) return 'disabled';

  const connected = status?.Status === 'Connected';
  const captureFps = parseFps(status?.CaptureFPS);

  if (!connected || captureFps === 0) return 'offline';

  const analysisEnabled = is138Plus
    ? monitor.Analysing !== 'None'
    : ANALYSIS_FUNCTIONS.has(monitor.Function);

  if (analysisEnabled && parseFps(status?.AnalysisFPS) === 0) return 'warning';

  return 'live';
}

/**
 * True when the monitor records continuously rather than only on alarm.
 *
 * ZoneMinder 1.38 split Function into independent controls, so the answer
 * lives in a different field either side of that line: `Recording` from 1.38
 * on, `Function` before it. A monitor that is always recording is always
 * "in an event", which is why callers such as Live Activity treat it as noise
 * rather than as something happening right now.
 */
export function isContinuousRecording(monitor: Monitor, zmVersion: string | null): boolean {
  return isZmVersionAtLeast(zmVersion, '1.38.0')
    ? monitor.Recording === 'Always'
    : CONTINUOUS_FUNCTIONS.has(monitor.Function);
}

/** True when the monitor should be showing a video stream. */
export function isMonitorStreamable(state: MonitorRunState): boolean {
  return state === 'live' || state === 'warning';
}

/** Tailwind color class for the status dot. */
export function monitorDotColor(state: MonitorRunState): string {
  switch (state) {
    case 'live': return 'bg-green-500';
    case 'warning': return 'bg-amber-500';
    case 'offline': return 'bg-red-500';
    case 'disabled': return 'bg-zinc-400 dark:bg-zinc-600';
  }
}
