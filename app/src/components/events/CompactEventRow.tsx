/**
 * Compact event row for the monitor-detail recent-events list.
 * Thumbnail + detection (or cause) + event id + time + relative time + score,
 * with a delete button. Clicking the row opens the event detail.
 */
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { EventThumbnail } from './EventThumbnail';
import { EventDeleteButton } from './EventDeleteButton';
import { parseDetectedObjects } from '../../lib/event-detection';
import { getObjectClassIconFromList } from '../../lib/object-class-icons';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import type { Event } from '../../api/types';

interface CompactEventRowProps {
  event: Event;
  thumbnailUrls: string[];
  aspectRatio: number;
  objectFit?: CSSProperties['objectFit'];
  monitorName?: string;
}

export function CompactEventRow({ event, thumbnailUrls, aspectRatio, objectFit = 'cover', monitorName }: CompactEventRowProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtTime } = useDateTimeFormat();
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));
  const detected = parseDetectedObjects(event.Notes);
  const DetIcon = detected.length ? getObjectClassIconFromList(detected.join(',')) : null;
  const primaryText = detected.length ? detected.join(', ') : event.Cause;
  const showRelative = isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS);
  const open = () =>
    navigate(`/events/${event.Id}`, { state: { from: `/monitors/${event.MonitorId}` } });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className="flex items-center gap-2.5 rounded-md p-1.5 cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary"
      data-testid="compact-event-row"
      data-event-id={event.Id}
      aria-label={`${t('common.view')}: ${event.Name}`}
    >
      <div
        className="relative flex-shrink-0 w-16 rounded overflow-hidden bg-card border border-border/40"
        style={{ aspectRatio: aspectRatio.toString() }}
      >
        <EventThumbnail
          urls={thumbnailUrls}
          cacheKey={event.Id}
          alt={event.Name}
          className="w-full h-full"
          objectFit={objectFit}
          loading="lazy"
          data-testid="compact-event-thumbnail"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {DetIcon && <DetIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm truncate" title={primaryText}>{primaryText}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">· #{event.Id}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {fmtTime(startTime)}
          {showRelative && ` · ${formatEventRelative(startTime, i18n.language, t)}`}
        </p>
      </div>
      <span
        className="flex-shrink-0 text-xs font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
        title={t('events.score')}
      >
        {event.MaxScore}
      </span>
      <EventDeleteButton
        eventId={event.Id}
        eventName={event.Name}
        monitorName={monitorName}
        size="sm"
        className="flex-shrink-0"
      />
    </div>
  );
}
