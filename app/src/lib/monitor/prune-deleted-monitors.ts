/**
 * Pruning references to monitors ZoneMinder no longer has.
 *
 * Monitor ids are persisted in several places: the per-profile hidden list,
 * each montage group's hidden list and working layout, and dashboard widget
 * settings. Deleting a monitor in ZoneMinder removes it from the API but not
 * from any of those, so it lingers as a ghost: counted as hidden while absent
 * from the list that would let you un-hide it (refs #324), or listed as
 * "Monitor 12" in a widget's display order (refs #323).
 *
 * These functions are pure and report "nothing to do" rather than returning a
 * fresh copy, so a caller can write only when something actually changed.
 * Deciding *when* it is safe to prune belongs to the caller: an incomplete
 * monitor list would read as "everything was deleted" and take the user's
 * configuration with it.
 */

import type { Layout } from 'react-grid-layout';
import type { MontageGroupLayout, ProfileSettings } from '../../stores/settings';
import type { DashboardWidget } from '../../stores/dashboard';

/** Same array back when every id survives, so callers can compare by identity. */
function keepKnown(ids: string[], known: Set<string>): string[] {
  const kept = ids.filter((id) => known.has(id));
  return kept.length === ids.length ? ids : kept;
}

function keepKnownLayout(layout: Layout[], known: Set<string>): Layout[] {
  const kept = layout.filter((item) => known.has(item.i));
  return kept.length === layout.length ? layout : kept;
}

function pruneGroup(bucket: MontageGroupLayout, known: Set<string>): MontageGroupLayout | null {
  const hiddenMonitorIds = keepKnown(bucket.hiddenMonitorIds, known);
  const workingLayout = keepKnownLayout(bucket.workingLayout, known);
  if (hiddenMonitorIds === bucket.hiddenMonitorIds && workingLayout === bucket.workingLayout) {
    return null;
  }
  // savedLayouts stays as it is. Those are named arrangements the user made
  // and may reload later; an entry for a monitor that is gone renders nothing
  // and costs nothing, which is a better trade than editing saved work.
  return { ...bucket, hiddenMonitorIds, workingLayout };
}

/**
 * Build the settings patch that removes every reference to a monitor outside
 * `known`, or null when the settings hold no stale ids.
 */
export function pruneProfileSettingsMonitorIds(
  settings: Pick<Partial<ProfileSettings>, 'excludedMonitorIds' | 'montageByGroup'>,
  known: Set<string>
): Partial<ProfileSettings> | null {
  const patch: Partial<ProfileSettings> = {};

  const excluded = settings.excludedMonitorIds ?? [];
  const keptExcluded = keepKnown(excluded, known);
  if (keptExcluded !== excluded) patch.excludedMonitorIds = keptExcluded;

  const byGroup = settings.montageByGroup;
  if (byGroup) {
    let groupsChanged = false;
    const nextGroups: Record<string, MontageGroupLayout> = {};
    for (const [groupKey, bucket] of Object.entries(byGroup)) {
      const pruned = pruneGroup(bucket, known);
      nextGroups[groupKey] = pruned ?? bucket;
      if (pruned) groupsChanged = true;
    }
    if (groupsChanged) patch.montageByGroup = nextGroups;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** A widget id with the settings it should be updated to. */
export interface WidgetSettingsUpdate {
  id: string;
  settings: DashboardWidget['settings'];
}

/**
 * Build the widget updates that remove every reference to a monitor outside
 * `known`. Widgets left with no monitor are kept, not deleted: an empty widget
 * is recoverable, a deleted one is not.
 */
export function pruneWidgetMonitorIds(
  widgets: DashboardWidget[],
  known: Set<string>
): WidgetSettingsUpdate[] {
  const updates: WidgetSettingsUpdate[] = [];

  for (const widget of widgets) {
    const { monitorIds, monitorId } = widget.settings;
    const keptIds = monitorIds ? keepKnown(monitorIds, known) : undefined;
    const idIsStale = monitorId !== undefined && !known.has(monitorId);
    if (keptIds === monitorIds && !idIsStale) continue;

    const settings = { ...widget.settings };
    if (keptIds) settings.monitorIds = keptIds;
    if (idIsStale) delete settings.monitorId;
    updates.push({ id: widget.id, settings });
  }

  return updates;
}
