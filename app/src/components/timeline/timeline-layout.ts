/** Event data used by the timeline renderer and hit-test. */
export interface TimelineEvent {
  id: string;
  monitorId: string;
  startMs: number;
  endMs: number;
  cause: string;
  alarmRatio: number;
  notes: string;
  /** Timestamp (ms) when this event was injected in live mode. Used for pulse animation. */
  arrivedAt?: number;
  /** All mode only: the owning profile's display name, for chip labels. */
  profileChip?: string;
  /** All mode only: the owning profile id. Consumers that need to resolve
   *  that profile's own session (the scrubber's preview thumbnail, a
   *  scrubber tap) read this instead of the (absent or wrong) current
   *  profile. Undefined in single mode (refs #337 Task 2/3). */
  profileId?: string;
  /** All mode only: `monitorId` above is overwritten with the composite
   *  `${profileId}:${monitorId}` key so the renderer's event->row matching
   *  doesn't collide across two profiles' servers (see Timeline.tsx's
   *  canvasEvents mapping); this preserves the real numeric monitor id for
   *  consumers that need to build a URL from it. Undefined in single mode. */
  realMonitorId?: string;
}

/** Fixed layout dimensions for the timeline canvas. */
export const LAYOUT = {
  headerHeight: 40,
  rowHeight: 48,
  eventPadding: 6,
  eventMinWidth: 4,
  labelWidth: 120,
  minimapHeight: 24,
  fontSize: 12,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
} as const;

/** 10-color palette for distinguishing monitors. */
export const MONITOR_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
] as const;

/** Returns a color for the given monitor index, cycling through the palette. */
export function getMonitorColor(index: number): string {
  return MONITOR_COLORS[index % MONITOR_COLORS.length];
}

/** Returns the Y pixel position for the top of a given row. */
export function getRowY(rowIndex: number): number {
  return LAYOUT.headerHeight + rowIndex * LAYOUT.rowHeight;
}

/** Converts a timestamp (ms) to an X pixel coordinate within the canvas. */
export function timeToX(
  timeMs: number,
  viewStartMs: number,
  viewEndMs: number,
  canvasWidth: number,
): number {
  const ratio = (timeMs - viewStartMs) / (viewEndMs - viewStartMs);
  return ratio * canvasWidth;
}

/** Converts an X pixel coordinate back to a timestamp (ms). Inverse of timeToX. */
export function xToTime(
  x: number,
  viewStartMs: number,
  viewEndMs: number,
  canvasWidth: number,
): number {
  const ratio = x / canvasWidth;
  return viewStartMs + ratio * (viewEndMs - viewStartMs);
}

/** Returns the total canvas height for a given number of monitor rows. */
export function canvasHeight(rowCount: number): number {
  return LAYOUT.headerHeight + rowCount * LAYOUT.rowHeight;
}
