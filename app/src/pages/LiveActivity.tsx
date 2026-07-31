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
import { EyeClosed } from 'lucide-react';
import { getMonitors } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAlarmStates } from '../hooks/useAlarmStates';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { useMeasuredWidth } from '../hooks/useMeasuredWidth';
import { getLiveActivityRowSpan } from '../lib/monitor/live-activity-layout';
import { LIVE_ACTIVITY } from '../lib/zmninja-ng-constants';
import { resolvePollIntervalMs, useNotificationStore } from '../stores/notifications';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  applyLiveAlarmHints,
  releaseDismissed,
  sameMonitorOrder,
  type ActiveMonitorEntry,
} from '../lib/monitor/live-activity';
import { isContinuousRecording } from '../lib/monitor/monitor-status';
import { runViewTransition } from '../lib/view-transition';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';
import { useFullscreenMode } from '../hooks/useFullscreenMode';
import { LiveActivitySettingsDialog } from '../components/live-activity/LiveActivitySettingsDialog';
import { LiveActivityTile } from '../components/live-activity/LiveActivityTile';
import {
  LiveActivityHeader,
  LiveActivityFullscreenBar,
} from '../components/live-activity/LiveActivityChrome';
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
  // Clock for the per-tile elapsed labels. A plain number rather than a Date
  // so an unchanged tick cannot produce a new reference, and advanced by the
  // cooling interval below rather than by a second timer of its own.
  const [now, setNow] = useState(() => Date.now());
  // Monitors the user cleared by hand. A ref rather than state, and page-local
  // rather than a profile setting: it is not a preference, nothing renders it
  // directly, and every read of it happens inside applyStates, which publishes
  // the list a dismissal actually changes. Held for the page's lifetime only,
  // so a dismissal does not outlive the visit that made it.
  const dismissedRef = useRef<ReadonlySet<string>>(new Set());

  // Websocket/push accelerant: a notification received in the last dwell
  // window promotes its monitor into the current poll snapshot immediately,
  // rather than waiting up to one poll interval for ZoneMinder to confirm it.
  // applyLiveAlarmHints only ever promotes a monitor already present in
  // `states`, so a hint for a page-ignored or profile-excluded monitor id is
  // dropped, not resurrected.
  //
  // The same pass also collects what ZoneMinder said triggered each of those
  // events, which is the only place a cause is available: the alarm poll
  // reports a state and nothing more. Values stay plain strings so useShallow
  // can compare the map entry by entry; an object per monitor would compare
  // by identity and defeat it.
  //
  // ponytail: this selector rebuilds the Map on every evaluation, so useShallow
  // still re-runs the filter/map on unrelated notification-store writes (it
  // just avoids a re-render when the resulting Map is contents-equal). If that
  // shows up as a real cost, memoize the profile's event list with a
  // reference-stable selector and build the Map in a separate useMemo keyed
  // off that list.
  const recentCauses = useNotificationStore(
    useShallow((state) => {
      const causes = new Map<string, string>();
      const events = currentProfile ? state.profileEvents[currentProfile.id] : undefined;
      if (!events?.length) return causes;
      const cutoff = Date.now() - dwellMs;
      // Newest first, so the first entry seen for a monitor is its latest.
      for (const event of events) {
        if (event.receivedAt < cutoff) continue;
        const monitorId = String(event.MonitorId);
        if (!causes.has(monitorId)) causes.set(monitorId, event.Cause ?? '');
      }
      return causes;
    })
  );

  const hintedMonitorIds = useMemo(() => new Set(recentCauses.keys()), [recentCauses]);

  const hintedStates = useMemo(
    () => applyLiveAlarmHints(states, hintedMonitorIds),
    [states, hintedMonitorIds]
  );

  // Runs the dwell policy and publishes the result. Identity-stable (no deps):
  // both effects below list it, and an identity that changed per render would
  // tear the one-second interval down before its 1000ms ever elapsed.
  const applyStates = useCallback(
    (
      statesNow: Record<string, MonitorAlarmState>,
      dwell: number,
      causes: ReadonlyMap<string, string>
    ) => {
      const prev = activeRef.current;
      const next = reduceActiveMonitors(prev, statesNow, Date.now(), dwell, {
        causes,
        dismissed: dismissedRef.current,
      });
      // Released after the reduce, never before it: a tile dismissed while it
      // was already cooling is not alarming, so releasing first would clear
      // the dismissal in the same pass that was supposed to honour it and the
      // tile would survive its own dismissal.
      dismissedRef.current = releaseDismissed(dismissedRef.current, statesNow);
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
    applyStates(hintedStates, dwellMs, recentCauses);
  }, [hintedStates, dwellMs, recentCauses, applyStates]);

  // Removal goes back through the reducer rather than being filtered out at
  // render time, so a dismissed tile unmounts for real and its stream is quit
  // instead of being left running behind a hidden element.
  const handleDismiss = useCallback(
    (monitorId: string) => {
      dismissedRef.current = new Set(dismissedRef.current).add(monitorId);
      applyStates(hintedStates, dwellMs, recentCauses);
    },
    [hintedStates, dwellMs, recentCauses, applyStates]
  );

  // A cooling monitor expires on a timer, not on a poll response, so the list
  // still empties when every monitor has gone quiet and nothing is changing.
  // The same tick advances the clock the elapsed labels read: a second
  // interval for those would run alongside this one for the same reason and
  // at the same rate, and this one is already scoped to exactly when tiles
  // exist.
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      applyStates(hintedStates, dwellMs, recentCauses);
    }, 1000);
    return () => clearInterval(timer);
  }, [active.length, hintedStates, dwellMs, recentCauses, applyStates]);

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

  // Tile heights are computed in pixels (see lib/monitor/live-activity-layout
  // .ts), so the grid has to be measured. useEventMontageGrid reads the same
  // element, but only to decide whether a column count fits, and never reports
  // the width, so this measures it and keeps that hook's ref pointed at the
  // same element.
  const { width: gridWidth, setElement: setGridElement } = useMeasuredWidth(gridContainerRef);

  // Its own settings key, not montageIsFullscreen: a shared flag would make
  // going fullscreen here put the Montage page in fullscreen too.
  const { isFullscreen, handleToggleFullscreen } = useFullscreenMode({
    currentProfile,
    settings,
    settingKey: 'liveActivityIsFullscreen',
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

  // The grid and everything that stands in for it, shared by both chrome
  // treatments below so fullscreen cannot drift from the normal page.
  const body = (
    <>
      {error && <ErrorBanner message={resolveQueryError(error, t)} />}

      {showSkeleton && (
        <div
          // Same element ref as the real grid, so the width is already
          // measured when the first tiles arrive and they are packed on their
          // first frame rather than laying out once and then again.
          ref={setGridElement}
          className="grid"
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
            icon={EyeClosed}
            title={t('live_activity.all_quiet')}
            description={t('live_activity.watching_count', { count: watchedIds.length })}
          />
        </div>
      )}

      {!isEmpty && (
        <div
          ref={setGridElement}
          // items-start, so each tile keeps the height its camera's aspect
          // ratio gives it and never stretches to fill the rows it spans.
          // The default stretch would pull a tile up to the rounded-up span
          // below, and since the video area inside a tile is pinned to its own
          // ratio, that extra height would arrive as dead black space under
          // the picture along with the elapsed label floating in it.
          //
          // Rows are one pixel tall and each tile spans its own height, so
          // tiles never share a row and a short camera beside a tall one no
          // longer leaves a hole under itself. Until the grid has been
          // measured there are no spans to honour, so the row unit stays off
          // and tiles keep their natural heights for that one frame.
          className="grid items-start"
          style={{
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
            gridAutoRows: gridWidth > 0 ? `${LIVE_ACTIVITY.rowUnitPx}px` : undefined,
          }}
        >
          {visible.map((entry) => {
            const monitorData = monitorsById.get(entry.monitorId);
            if (!monitorData) return null;
            return (
              <LiveActivityTile
                key={entry.monitorId}
                entry={entry}
                monitor={monitorData.Monitor}
                status={monitorData.Monitor_Status}
                currentProfile={currentProfile}
                accessToken={accessToken}
                navigate={navigate}
                now={now}
                // Recomputed per render, but it only ever changes with the
                // grid width, the column count or the camera's own shape, so
                // the one-second clock never moves it.
                rowSpan={
                  gridWidth > 0
                    ? getLiveActivityRowSpan(monitorData.Monitor, gridWidth, gridCols)
                    : undefined
                }
                onDismiss={handleDismiss}
              />
            );
          })}
        </div>
      )}

      {overflowCount > 0 && (
        <p className="text-sm text-muted-foreground mt-3" data-testid="live-activity-overflow">
          {t('live_activity.overflow', { count: overflowCount })}
        </p>
      )}

    </>
  );

  // Fullscreen drops the page chrome the way Montage does: the app frame is
  // covered edge to edge and the only control left is the thin translucent
  // bar, so a wall display shows tiles and nothing else.
  if (isFullscreen) {
    return (
      <div
        className="fixed inset-0 z-40 bg-black flex flex-col"
        data-testid="live-activity-fullscreen"
      >
        <LiveActivityFullscreenBar onExit={() => handleToggleFullscreen(false)} />
        <div className="flex-1 overflow-auto p-2">
          {body}
        </div>
      </div>
    );
  }

  return (
    <PageContainer>
      <LiveActivityHeader
        gridCols={gridCols}
        customCols={customCols}
        isCustomGridDialogOpen={isCustomGridDialogOpen}
        onApplyGridLayout={handleApplyGridLayout}
        onCustomColsChange={setCustomCols}
        onCustomGridDialogOpenChange={setIsCustomGridDialogOpen}
        onCustomGridSubmit={handleCustomGridSubmit}
        onEnterFullscreen={() => handleToggleFullscreen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {currentProfile && (
        <LiveActivitySettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          profileId={currentProfile.id}
          monitors={data?.monitors ?? []}
        />
      )}

      {body}
    </PageContainer>
  );
}
