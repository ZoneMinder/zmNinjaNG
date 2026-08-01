/**
 * useReconcileDeletedMonitors Hook
 *
 * Drops stored references to monitors ZoneMinder no longer has, once per
 * profile per successful monitor fetch. Deleting a monitor in ZoneMinder used
 * to leave it behind forever: still counted in Settings' hidden monitors with
 * no way to un-hide it, and still listed in a dashboard widget's display order
 * as "Monitor 12" (refs #323, #324).
 *
 * The list has to be the one that includes excluded monitors. The ordinary
 * monitors query has already dropped the hidden ones, and reconciling the
 * hidden list against a list built by removing it would delete every entry.
 *
 * Nothing is pruned unless the fetch succeeded and returned at least one
 * monitor. An empty or failed response is indistinguishable from "every
 * monitor was deleted", and acting on it would take the user's configuration
 * with it.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { useAuthStore } from '../stores/auth';
import { useCurrentProfile } from './useCurrentProfile';
import { useSettingsStore } from '../stores/settings';
import { useDashboardStore } from '../stores/dashboard';
import { log, LogLevel } from '../lib/logger';
import {
  pruneProfileSettingsMonitorIds,
  pruneWidgetMonitorIds,
} from '../lib/monitor/prune-deleted-monitors';

export function useReconcileDeletedMonitors(): void {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const profileId = currentProfile?.id;

  // Same key the hidden-monitors setting uses, so this shares its cache rather
  // than adding a second full monitor fetch.
  const { data, isSuccess } = useQuery({
    queryKey: queryKeys.monitorsAllIncludingExcluded(profileId),
    queryFn: () => getMonitors({ includeExcluded: true }),
    enabled: !!profileId && isAuthenticated,
  });

  const monitors = data?.monitors;

  useEffect(() => {
    if (!profileId || !isSuccess || !monitors?.length) return;

    const known = new Set(monitors.map(({ Monitor }) => Monitor.Id));

    const settingsState = useSettingsStore.getState();
    const patch = pruneProfileSettingsMonitorIds(
      settingsState.getProfileSettings(profileId),
      known
    );
    if (patch) {
      settingsState.updateProfileSettings(profileId, patch);
      log.monitor('Dropped deleted monitors from profile settings', LogLevel.INFO, {
        keys: Object.keys(patch),
      });
    }

    const dashboardState = useDashboardStore.getState();
    const widgetUpdates = pruneWidgetMonitorIds(dashboardState.widgets[profileId] ?? [], known);
    for (const { id, settings } of widgetUpdates) {
      dashboardState.updateWidget(profileId, id, { settings });
    }
    if (widgetUpdates.length > 0) {
      log.dashboard('Dropped deleted monitors from dashboard widgets', LogLevel.INFO, {
        count: widgetUpdates.length,
      });
    }
  }, [profileId, isSuccess, monitors]);
}
