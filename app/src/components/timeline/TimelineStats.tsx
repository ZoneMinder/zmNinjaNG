/**
 * TimelineStats
 *
 * Compact inline statistics row for the Timeline page: total events,
 * active monitors, alarm frames, and total duration.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventData } from '../../api/types';

interface TimelineStatsProps {
  events: EventData[];
}

export function TimelineStats({ events }: TimelineStatsProps) {
  const { t } = useTranslation();

  const totalAlarmFrames = useMemo(
    () => events.reduce((sum, e) => sum + parseInt(e.Event.AlarmFrames || '0'), 0),
    [events]
  );
  const totalDurationMins = useMemo(
    () => Math.round(events.reduce((sum, e) => sum + parseFloat(e.Event.Length || '0'), 0) / 60),
    [events]
  );
  const activeMonitorCount = useMemo(
    () => new Set(events.map((e) => e.Event.MonitorId)).size,
    [events]
  );

  if (events.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="timeline-statistics">
      <span><span className="font-semibold text-blue-500">{events.length}</span> {t('timeline.total_events')}</span>
      <span className="text-border">|</span>
      <span><span className="font-semibold text-green-500">{activeMonitorCount}</span> {t('timeline.active_monitors')}</span>
      <span className="text-border">|</span>
      <span><span className="font-semibold text-amber-500">{totalAlarmFrames.toLocaleString()}</span> {t('timeline.alarm_frames')}</span>
      <span className="text-border">|</span>
      <span><span className="font-semibold text-purple-500">{totalDurationMins}m</span> {t('timeline.total_duration')}</span>
    </div>
  );
}
