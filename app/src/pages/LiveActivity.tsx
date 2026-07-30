/**
 * Live Activity.
 *
 * Only the monitors ZoneMinder currently reports as alarming, as montage
 * tiles. A monitor appears on alarm and leaves once the dwell window from its
 * last alarm closes. See lib/monitor/live-activity.ts for why the dwell
 * window exists (it protects nph-zms, not just the eye).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { getMonitors } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAlarmStates } from '../hooks/useAlarmStates';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { resolvePollIntervalMs } from '../stores/notifications';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  type ActiveMonitorEntry,
} from '../lib/monitor/live-activity';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { PageContainer } from '../components/common/PageContainer';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';

/** Locale key for each state that can appear in a tile title. */
const STATE_LABEL_KEYS: Record<MonitorAlarmState, string> = {
  alarm: 'live_activity.state_alarm',
  alert: 'live_activity.state_alert',
  idle: 'live_activity.state_cooling',
  prealarm: 'live_activity.state_cooling',
  tape: 'live_activity.state_cooling',
  unknown: 'live_activity.state_cooling',
};

export default function LiveActivity() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile, settings } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const bandwidth = useBandwidthSettings();
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading: monitorsLoading, error: monitorsError } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(),
    enabled: !!currentProfile && isAuthenticated,
    refetchInterval: bandwidth.monitorStatusInterval,
  });

  // Monitors this page is allowed to watch. The profile-wide exclusion is
  // already applied inside getMonitors; this drops the page-specific ignores.
  const watchedIds = useMemo(() => {
    const ignored = new Set(settings.liveActivityIgnoredMonitorIds);
    return (data?.monitors ?? [])
      .map(({ Monitor }) => Monitor.Id)
      .filter((id) => !ignored.has(id));
  }, [data?.monitors, settings.liveActivityIgnoredMonitorIds]);

  const pollIntervalMs = resolvePollIntervalMs(
    settings.bandwidthMode,
    settings.liveActivityPollSeconds,
    'alarmStatusInterval'
  );

  // enabled stays a constant true for the page's whole lifetime (never toggled
  // off while mounted): useAlarmStates reports an empty `states` map while
  // disabled, and feeding that into reduceActiveMonitors below would drop
  // every resident monitor instantly with no dwell window, the exact tile
  // churn the dwell window exists to prevent (refs #313).
  const { states, error: alarmError } = useAlarmStates(watchedIds, {
    enabled: true,
    pollIntervalMs,
  });

  // The damped display list. Held in state rather than derived during render
  // because it depends on the previous list and on the current time.
  const [active, setActive] = useState<ActiveMonitorEntry[]>([]);
  const dwellMs = settings.liveActivityDwellSeconds * 1000;

  useEffect(() => {
    setActive((prev) => reduceActiveMonitors(prev, states, Date.now(), dwellMs));
  }, [states, dwellMs]);

  // A cooling monitor expires on a timer, not on a poll response, so the list
  // still empties when every monitor has gone quiet and nothing is changing.
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => {
      setActive((prev) => reduceActiveMonitors(prev, states, Date.now(), dwellMs));
    }, 1000);
    return () => clearInterval(timer);
  }, [active.length, states, dwellMs]);

  const { visible, overflowCount } = capActiveMonitors(active, settings.liveActivityMaxTiles);

  const monitorsById = useMemo(
    () => new Map((data?.monitors ?? []).map((m) => [m.Monitor.Id, m])),
    [data?.monitors]
  );

  const {
    gridCols,
    isCustomGridDialogOpen,
    setIsCustomGridDialogOpen,
    customCols,
    setCustomCols,
    handleApplyGridLayout,
    handleCustomGridSubmit,
  } = useEventMontageGrid({
    initialCols: settings.monitorGridCols,
    containerRef: gridContainerRef,
  });

  const error = monitorsError ?? alarmError;

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold min-w-0 truncate" title={t('live_activity.title')}>
          {t('live_activity.title')}
        </h1>
        <EventMontageGridControls
          gridCols={gridCols}
          customCols={customCols}
          isCustomGridDialogOpen={isCustomGridDialogOpen}
          onApplyGridLayout={handleApplyGridLayout}
          onCustomColsChange={setCustomCols}
          onCustomGridDialogOpenChange={setIsCustomGridDialogOpen}
          onCustomGridSubmit={handleCustomGridSubmit}
        />
      </div>

      {error && <ErrorBanner message={resolveQueryError(error, t)} />}

      {visible.length === 0 && !monitorsLoading ? (
        <div data-testid="live-activity-empty">
          <EmptyState
            icon={Activity}
            title={t('live_activity.all_quiet')}
            description={t('live_activity.watching_count', { count: watchedIds.length })}
          />
        </div>
      ) : (
        <div
          ref={gridContainerRef}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {visible.map((entry) => {
            const monitorData = monitorsById.get(entry.monitorId);
            if (!monitorData) return null;
            const title = t('live_activity.tile_title', {
              name: monitorData.Monitor.Name,
              id: entry.monitorId,
              state: t(STATE_LABEL_KEYS[entry.state]),
            });
            return (
              <div
                key={entry.monitorId}
                className={entry.isCooling ? 'opacity-60 transition-opacity' : 'transition-opacity'}
                data-testid="live-activity-tile"
              >
                <MontageMonitor
                  monitor={monitorData.Monitor}
                  status={monitorData.Monitor_Status}
                  currentProfile={currentProfile}
                  accessToken={accessToken}
                  navigate={navigate}
                  titleOverride={title}
                />
              </div>
            );
          })}
        </div>
      )}

      {overflowCount > 0 && (
        <p className="text-sm text-muted-foreground mt-3" data-testid="live-activity-overflow">
          {t('live_activity.overflow', { count: overflowCount })}
        </p>
      )}
    </PageContainer>
  );
}
