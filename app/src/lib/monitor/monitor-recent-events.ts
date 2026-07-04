/**
 * Helpers for the recent-events list on the monitor detail page.
 * Pure functions: clamp the configured count and manage the per-monitor
 * hidden set stored in profile settings.
 */
import { MONITOR_DETAIL_RECENT_EVENTS } from '../zmninja-ng-constants';

export function clampRecentEventsCount(n: number): number {
  const { minCount, maxCount, defaultCount } = MONITOR_DETAIL_RECENT_EVENTS;
  if (!Number.isFinite(n)) return defaultCount;
  return Math.min(maxCount, Math.max(minCount, Math.round(n)));
}

export function isMonitorRecentEventsHidden(hidden: string[], monitorId: string): boolean {
  return hidden.includes(monitorId);
}

export function toggleMonitorRecentEventsHidden(hidden: string[], monitorId: string): string[] {
  return hidden.includes(monitorId)
    ? hidden.filter((id) => id !== monitorId)
    : [...hidden, monitorId];
}
