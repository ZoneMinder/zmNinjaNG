/**
 * Live Activity.
 *
 * Only the monitors ZoneMinder currently reports as alarming, as montage
 * tiles. A monitor appears on alarm and leaves once the dwell window from its
 * last alarm closes. See lib/monitor/live-activity.ts for why the dwell
 * window exists (it protects nph-zms, not just the eye).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { Activity, Settings } from 'lucide-react';
import { getMonitors } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAlarmStates } from '../hooks/useAlarmStates';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { resolvePollIntervalMs, useNotificationStore } from '../stores/notifications';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  applyLiveAlarmHints,
  type ActiveMonitorEntry,
} from '../lib/monitor/live-activity';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { LiveActivitySettingsDialog } from '../components/live-activity/LiveActivitySettingsDialog';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorBanner } from '../components/ui/query-state';
import { Skeleton } from '../components/ui/skeleton';
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
  const updateSettings = useSettingsStore((s) => s.updateProfileSettings);
  const bandwidth = useBandwidthSettings();
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
  const { states, isLoading: alarmsLoading, error: alarmError } = useAlarmStates(watchedIds, {
    enabled: true,
    pollIntervalMs,
  });

  // The damped display list. Held in state rather than derived during render
  // because it depends on the previous list and on the current time.
  const [active, setActive] = useState<ActiveMonitorEntry[]>([]);
  const dwellMs = settings.liveActivityDwellSeconds * 1000;

  // Websocket/push accelerant: a notification received in the last dwell
  // window promotes its monitor into the current poll snapshot immediately,
  // rather than waiting up to one poll interval for ZoneMinder to confirm it.
  // applyLiveAlarmHints only ever promotes a monitor already present in
  // `states`, so a hint for a page-ignored or profile-excluded monitor id is
  // dropped, not resurrected.
  //
  // ponytail: this selector rebuilds the Set on every evaluation, so useShallow
  // still re-runs the filter/map on unrelated notification-store writes (it
  // just avoids a re-render when the resulting Set is contents-equal). If that
  // shows up as a real cost, memoize the profile's event list with a
  // reference-stable selector and build the Set in a separate useMemo keyed
  // off that list.
  const hintedMonitorIds = useNotificationStore(
    useShallow((state) => {
      const events = currentProfile ? state.profileEvents[currentProfile.id] : undefined;
      if (!events?.length) return new Set<string>();
      const cutoff = Date.now() - dwellMs;
      return new Set(
        events.filter((e) => e.receivedAt >= cutoff).map((e) => String(e.MonitorId))
      );
    })
  );

  const hintedStates = useMemo(
    () => applyLiveAlarmHints(states, hintedMonitorIds),
    [states, hintedMonitorIds]
  );

  useEffect(() => {
    setActive((prev) => reduceActiveMonitors(prev, hintedStates, Date.now(), dwellMs));
  }, [hintedStates, dwellMs]);

  // A cooling monitor expires on a timer, not on a poll response, so the list
  // still empties when every monitor has gone quiet and nothing is changing.
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => {
      setActive((prev) => reduceActiveMonitors(prev, hintedStates, Date.now(), dwellMs));
    }, 1000);
    return () => clearInterval(timer);
  }, [active.length, hintedStates, dwellMs]);

  const { visible, overflowCount } = capActiveMonitors(active, settings.liveActivityMaxTiles);

  const monitorsById = useMemo(
    () => new Map((data?.monitors ?? []).map((m) => [m.Monitor.Id, m])),
    [data?.monitors]
  );

  // Shares monitorGridCols with the Monitors page rather than a dedicated
  // liveActivityGridCols setting: one grid-density preference per user is
  // simpler than two, and there is nothing page-specific about column count
  // the way there is for poll/dwell/tiles/ignore list.
  const handleGridChange = useCallback((cols: number) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, { monitorGridCols: cols });
  }, [currentProfile, updateSettings]);

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
    onGridChange: handleGridChange,
  });

  const error = monitorsError ?? alarmError;

  // "All quiet" is a claim about the server, so it is only honest once the
  // page has heard from it. An unreachable server leaves visible empty and
  // monitorsLoading false, and a failing alarm fanout dwells every tile out,
  // so without this gate an outage reads as a confident "nothing is
  // alarming" next to the error banner: the worst possible false negative
  // for a page whose whole job is answering that question.
  const isEmpty = visible.length === 0;
  const showSkeleton = isEmpty && (monitorsLoading || alarmsLoading);
  const showEmptyState = isEmpty && !showSkeleton && !error;

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold min-w-0 truncate" title={t('live_activity.title')}>
          {t('live_activity.title')}
        </h1>
        <div className="flex items-center gap-1">
          <EventMontageGridControls
            gridCols={gridCols}
            customCols={customCols}
            isCustomGridDialogOpen={isCustomGridDialogOpen}
            onApplyGridLayout={handleApplyGridLayout}
            onCustomColsChange={setCustomCols}
            onCustomGridDialogOpenChange={setIsCustomGridDialogOpen}
            onCustomGridSubmit={handleCustomGridSubmit}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSettingsOpen(true)}
            title={t('live_activity.settings_title')}
            aria-label={t('live_activity.settings_title')}
            data-testid="live-activity-settings-btn"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {currentProfile && (
        <LiveActivitySettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          profileId={currentProfile.id}
          monitors={data?.monitors ?? []}
        />
      )}

      {error && <ErrorBanner message={resolveQueryError(error, t)} />}

      {showSkeleton && (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
          data-testid="live-activity-loading"
        >
          {Array.from({ length: gridCols * 2 }, (_, i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      )}

      {showEmptyState && (
        <div data-testid="live-activity-empty">
          <EmptyState
            icon={Activity}
            title={t('live_activity.all_quiet')}
            description={t('live_activity.watching_count', { count: watchedIds.length })}
          />
        </div>
      )}

      {!isEmpty && (
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
                className={
                  entry.isCooling
                    ? 'relative opacity-60 transition-opacity'
                    : 'relative transition-opacity'
                }
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
                {entry.alarmCount > 1 && (
                  <span
                    className="absolute top-1 right-1 z-30 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white"
                    data-testid={`live-activity-count-${entry.monitorId}`}
                  >
                    {t('live_activity.alarm_count', { count: entry.alarmCount })}
                  </span>
                )}
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
