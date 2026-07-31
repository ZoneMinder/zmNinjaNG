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
  sameMonitorOrder,
  type ActiveMonitorEntry,
} from '../lib/monitor/live-activity';
import { isContinuousRecording } from '../lib/monitor/monitor-status';
import { runViewTransition } from '../lib/view-transition';
import { cn } from '../lib/utils';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { LiveActivitySettingsDialog } from '../components/live-activity/LiveActivitySettingsDialog';
import { LiveActivityStateIcon } from '../components/live-activity/LiveActivityStateIcon';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorBanner } from '../components/ui/query-state';
import { Skeleton } from '../components/ui/skeleton';
import { resolveQueryError } from '../lib/query/query-error';
import { PageContainer } from '../components/common/PageContainer';

export default function LiveActivity() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile, settings } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const zmVersion = useAuthStore((s) => s.version);
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
  // already applied inside getMonitors; this drops the page-specific ignores
  // and, unless the user opted them back in, the continuous recorders. A
  // monitor that always records is always in an event, so it would sit on this
  // page permanently and crowd out the monitors that are actually alarming.
  // The ignore list applies on top: an explicitly ignored monitor stays out
  // whether or not it is also opted in here.
  const watchedIds = useMemo(() => {
    const ignored = new Set(settings.liveActivityIgnoredMonitorIds);
    const watchContinuous = new Set(settings.liveActivityWatchContinuousIds);
    return (data?.monitors ?? [])
      .filter(
        ({ Monitor }) =>
          !ignored.has(Monitor.Id) &&
          (watchContinuous.has(Monitor.Id) || !isContinuousRecording(Monitor, zmVersion))
      )
      .map(({ Monitor }) => Monitor.Id);
  }, [
    data?.monitors,
    settings.liveActivityIgnoredMonitorIds,
    settings.liveActivityWatchContinuousIds,
    zmVersion,
  ]);

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
  // Mirrors `active` so the updater below can read the previous list without
  // listing it as an effect dependency. `active` in the cooling effect's deps
  // would rearm the interval on every list change, and since an alarming
  // monitor's entry restamps Date.now() on each pass, that never settles.
  const activeRef = useRef<ActiveMonitorEntry[]>(active);
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

  // Runs the dwell policy and publishes the result. Identity-stable (no deps):
  // both effects below list it, and an identity that changed per render would
  // tear the one-second interval down before its 1000ms ever elapsed.
  const applyStates = useCallback(
    (statesNow: Record<string, MonitorAlarmState>, dwell: number) => {
      const prev = activeRef.current;
      const next = reduceActiveMonitors(prev, statesNow, Date.now(), dwell);
      // reduceActiveMonitors hands back the same array when nothing moved, so
      // a poll tick that changed nothing costs no render at all.
      if (next === prev) return;
      activeRef.current = next;

      // Only tiles arriving, leaving, or swapping rows is worth a transition;
      // a state or count change happens in place and animates via CSS.
      if (sameMonitorOrder(prev, next)) {
        setActive(next);
        return;
      }
      runViewTransition(() => setActive(next));
    },
    []
  );

  useEffect(() => {
    applyStates(hintedStates, dwellMs);
  }, [hintedStates, dwellMs, applyStates]);

  // A cooling monitor expires on a timer, not on a poll response, so the list
  // still empties when every monitor has gone quiet and nothing is changing.
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => applyStates(hintedStates, dwellMs), 1000);
    return () => clearInterval(timer);
  }, [active.length, hintedStates, dwellMs, applyStates]);

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
            return (
              <div
                key={entry.monitorId}
                className={cn(
                  // Enter: a tile fades and scales up over 200ms instead of
                  // popping into the grid. tailwindcss-animate, the same
                  // utilities the dialogs and popovers use. The duration is
                  // an arbitrary-value class, not `duration-200`: cn() is
                  // twMerge, tailwindcss-animate maps `duration-*` onto
                  // animationDuration as well as transitionDuration, and
                  // twMerge would drop it in favor of the 700ms below.
                  'relative animate-in fade-in-0 zoom-in-95 [animation-duration:200ms]',
                  // Cooling: winding down reads as a slow fade and a drain of
                  // color over 700ms, not an instant step to 60%.
                  'transition-[opacity,filter] duration-700 ease-out',
                  entry.isCooling && 'opacity-60 saturate-50'
                )}
                // Pairs this tile's before and after positions across a view
                // transition, which is what lets it slide to its new row.
                // Ignored by browsers without the API.
                style={{ viewTransitionName: `live-activity-tile-${entry.monitorId}` }}
                data-testid="live-activity-tile"
              >
                <MontageMonitor
                  monitor={monitorData.Monitor}
                  status={monitorData.Monitor_Status}
                  currentProfile={currentProfile}
                  accessToken={accessToken}
                  navigate={navigate}
                  titleIcon={<LiveActivityStateIcon state={entry.state} />}
                  fromRoute="/live-activity"
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
