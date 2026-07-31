/**
 * One Live Activity tile: the live monitor plus the overlays that say how
 * long it has been going.
 *
 * Split out of the page because both the wrapper's rendering constraints and
 * the memo rules below need explaining where they live, and the page was
 * already near its size limit.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';
import type { Monitor, MonitorStatus, Profile } from '../../api/types';
import type { ActiveMonitorEntry } from '../../lib/monitor/live-activity';
import { formatElapsedShort } from '../../lib/format-date-time';
import { MontageMonitor } from '../monitors/MontageMonitor';
import { LiveActivityStateIcon } from './LiveActivityStateIcon';

interface LiveActivityTileProps {
  entry: ActiveMonitorEntry;
  monitor: Monitor;
  status: MonitorStatus | undefined;
  currentProfile: Profile | null;
  accessToken: string | null;
  navigate: NavigateFunction;
  /** The page's one-second clock. Drives the elapsed label and nothing else. */
  now: number;
}

export function LiveActivityTile({
  entry,
  monitor,
  status,
  currentProfile,
  accessToken,
  navigate,
  now,
}: LiveActivityTileProps) {
  const { t } = useTranslation();

  // MontageMonitor is memo'd with the default comparator, so every prop it
  // gets has to be reference-stable across a tick of `now` or the video tile
  // re-renders once a second. A JSX element built inline is a new object
  // every render, which is exactly that bug; this rebuilds only on a real
  // state change.
  const titleIcon = useMemo(() => <LiveActivityStateIcon state={entry.state} />, [entry.state]);

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
      style={{ viewTransitionName: `live-activity-tile-${entry.monitorId}` }}
      data-testid="live-activity-tile"
    >
      <MontageMonitor
        monitor={monitor}
        status={status}
        currentProfile={currentProfile}
        accessToken={accessToken}
        navigate={navigate}
        titleIcon={titleIcon}
        fromRoute="/live-activity"
      />
      {/* A sibling of the tile rather than one of its props, so the value
          that changes every second never reaches the memo'd component. */}
      <span
        className="absolute bottom-1 left-1 z-30 pointer-events-none text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-black/60 text-white"
        title={t('live_activity.elapsed_title')}
        data-testid={`live-activity-elapsed-${entry.monitorId}`}
      >
        {formatElapsedShort(now - entry.episodeStartedAt)}
      </span>
    </div>
  );
}
