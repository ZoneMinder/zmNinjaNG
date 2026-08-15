/**
 * One Live Activity tile: the live monitor plus the overlays that say how
 * long it has been going.
 *
 * Split out of the page because both the wrapper's rendering constraints and
 * the memo rules below need explaining where they live, and the page was
 * already near its size limit.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { Monitor, MonitorStatus, Profile, ProfileId } from '../../api/types';
import type { ActiveMonitorEntry } from '../../lib/monitor/live-activity';
import { formatElapsedShort } from '../../lib/format-date-time';
import { getMonitorAspectRatio } from '../../lib/monitor/monitor-rotation';
import { MONITOR_UI } from '../../lib/zmninja-ng-constants';
import { MontageMonitor } from '../monitors/MontageMonitor';
import { LiveActivityStateIcon } from './LiveActivityStateIcon';
import { HintButton } from '../ui/button';

interface LiveActivityTileProps {
  entry: ActiveMonitorEntry;
  monitor: Monitor;
  status: MonitorStatus | undefined;
  /** The tile's owning profile: the current profile in single mode, the
   *  monitor's OWN server in All mode (see useScopedMonitors / MontageMonitor). */
  currentProfile: Profile | null;
  accessToken: string | null;
  navigate: NavigateFunction;
  /** All mode only: the owning profile's id/display name, threaded straight
   *  through to MontageMonitor (its LiveMonitorPlayer cache-key scoping,
   *  events watermark, and profile chip). Undefined in single mode. */
  profileId?: ProfileId;
  profileChip?: string;
  /** The page's one-second clock. Drives the elapsed label and nothing else. */
  now: number;
  /**
   * Grid row units this tile occupies, from getLiveActivityRowSpan. Undefined
   * until the grid has been measured, which leaves the tile on plain
   * auto-placement for that first frame rather than squashing it into a
   * one pixel row.
   */
  rowSpan: number | undefined;
  /** Clears this monitor off the page for the rest of its current alarm. */
  onDismiss: (monitorId: string) => void;
}

export function LiveActivityTile({
  entry,
  monitor,
  status,
  currentProfile,
  accessToken,
  navigate,
  profileId,
  profileChip,
  now,
  rowSpan,
  onDismiss,
}: LiveActivityTileProps) {
  const { t } = useTranslation();

  // MontageMonitor is memo'd with the default comparator, so every prop it
  // gets has to be reference-stable across a tick of `now` or the video tile
  // re-renders once a second. A JSX element built inline is a new object
  // every render, which is exactly that bug; this rebuilds only on a real
  // state change.
  const titleIcon = useMemo(() => <LiveActivityStateIcon state={entry.state} />, [entry.state]);

  // The page's grid gives every column the same width and no height, so
  // without this a 4:3 camera, a 16:9 camera and a rotated portrait camera all
  // land in the same box and their video crops or letterboxes. Handing the
  // ratio to the media area rather than to this wrapper is what keeps the
  // header out of the camera's shape, and it makes the resulting tile height
  // the same header-plus-video sum Montage computes in useMontageGrid.
  // getMonitorAspectRatio has already swapped the axes for a 90 or 270 degree
  // rotation; it returns undefined when ZoneMinder's dimensions are unusable,
  // and a tile with no ratio at all would have no height.
  //
  // A plain string, so the memo'd MontageMonitor below still sees an identical
  // prop on every tick of `now`.
  const mediaAspectRatio =
    getMonitorAspectRatio(monitor.Width, monitor.Height, monitor.Orientation) ??
    MONITOR_UI.fallbackAspectRatio;

  // Stable identity: the elapsed label re-renders this component every second,
  // and a fresh function here would defeat MontageMonitor's memo and re-render
  // live video with it. Deep route while aggregating, so the monitor opens
  // against its own server without switching the active profile (refs #337).
  const openMonitor = useCallback(() => {
    navigate(
      profileId ? `/all/monitors/${profileId}/${monitor.Id}` : `/monitors/${monitor.Id}`,
      { state: { from: '/live-activity' } },
    );
  }, [navigate, profileId, monitor.Id]);

  return (
    <div
      // Enter: a tile fades and scales up over 200ms instead of popping into
      // the grid. tailwindcss-animate, the same utilities the dialogs and
      // popovers use.
      //
      // A cooling tile is styled exactly like an alarming one. It used to dim
      // to `opacity-60 saturate-50` over 700ms, and that was a rendering bug
      // as much as a taste one: this element carries the
      // `view-transition-name`, so it is the element the browser snapshots,
      // and a captured image is generated with the element's own visual
      // effects already applied while `::view-transition-new` is the live
      // element partway through the same 700ms animation. The user-agent
      // stylesheet composites that pair with `mix-blend-mode: plus-lighter`,
      // which only cross-fades correctly when both halves are the same image,
      // so a dimmed tile rendered wrong for the whole transition. Nothing on
      // this element may animate opacity or filter for that reason. Winding
      // down now reads only as the state icon dropping out of the tile
      // header. refs #313
      //
      // The enter duration stays an arbitrary-value class rather than
      // `duration-200`: tailwindcss-animate maps `duration-*` onto
      // animationDuration as well as transitionDuration, so a transition
      // duration added here later would silently win the twMerge conflict and
      // stretch the enter animation.
      className="relative animate-in fade-in-0 zoom-in-95 [animation-duration:200ms]"
      // Pairs this tile's before and after positions across a view
      // transition, which is what lets it slide to its new row. Ignored by
      // browsers without the API.
      //
      // gridRowEnd is placement, not a visual effect, so it is safe next to
      // the view-transition name the note above is about.
      //
      // entry.monitorId is monitorCacheKey(profileId, monitorId) in All mode
      // (`profileId:monitorId`), and a CSS custom-ident cannot contain a
      // colon - the browser drops the whole declaration, silently losing the
      // transition rather than erroring, so the colon is swapped for a dash.
      style={{
        viewTransitionName: `live-activity-tile-${entry.monitorId.replace(/:/g, '-')}`,
        gridRowEnd: rowSpan ? `span ${rowSpan}` : undefined,
      }}
      data-testid="live-activity-tile"
    >
      <MontageMonitor
        monitor={monitor}
        status={status}
        currentProfile={currentProfile}
        accessToken={accessToken}
        navigate={navigate}
        profileId={profileId}
        profileChip={profileChip}
        titleIcon={titleIcon}
        mediaAspectRatio={mediaAspectRatio}
        fromRoute="/live-activity"
        // Montage opens a monitor from a wrapper around the whole tile; this
        // page has none, so the media area is the target. Deep route while
        // aggregating, so the monitor opens against its own server without
        // switching the active profile first (refs #337).
        onMediaActivate={openMonitor}
      />
      {/* Sits where the alarm-count badge used to, clear of the tile header's
          own buttons. stopPropagation so clearing a tile never doubles as a
          click through to the monitor underneath. */}
      <HintButton
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(entry.monitorId);
        }}
        className="absolute top-1 right-1 z-30 rounded bg-black/60 p-1 text-white/80 hover:bg-black/80 hover:text-white focus-visible:ring-2 focus-visible:ring-primary"
        title={t('live_activity.dismiss', { name: monitor.Name })}
        aria-label={t('live_activity.dismiss', { name: monitor.Name })}
        data-testid={`live-activity-dismiss-${entry.monitorId}`}
      >
        <X className="h-3.5 w-3.5" />
      </HintButton>

      {/* Siblings of the tile rather than props of it, so the value that
          changes every second never reaches the memo'd component. */}
      <div className="absolute bottom-1 left-1 right-1 z-30 pointer-events-none flex items-end gap-1">
        <span
          className="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-black/60 text-white"
          title={t('live_activity.elapsed_title')}
          data-testid={`live-activity-elapsed-${entry.monitorId}`}
        >
          {formatElapsedShort(now - entry.episodeStartedAt)}
        </span>
        {/* Only the notification stream reports a cause, so most tiles never
            show this one. */}
        {entry.cause && (
          <span
            className="min-w-0 truncate text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white"
            title={entry.cause}
            data-testid={`live-activity-cause-${entry.monitorId}`}
          >
            {entry.cause}
          </span>
        )}
      </div>
    </div>
  );
}
