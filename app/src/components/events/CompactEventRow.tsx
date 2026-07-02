/**
 * Compact event row for the monitor-detail recent-events list.
 * Thumbnail + cause + time + score. Clicking opens the event detail.
 */
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { EventThumbnail } from './EventThumbnail';
import type { Event } from '../../api/types';

interface CompactEventRowProps {
  event: Event;
  thumbnailUrls: string[];
  aspectRatio: number;
  objectFit?: CSSProperties['objectFit'];
}

export function CompactEventRow({ event, thumbnailUrls, aspectRatio, objectFit = 'cover' }: CompactEventRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { fmtTime } = useDateTimeFormat();
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));
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
        <p className="text-sm truncate" title={event.Cause}>{event.Cause}</p>
        <p className="text-xs text-muted-foreground">{fmtTime(startTime)}</p>
      </div>
      <span
        className="flex-shrink-0 text-xs font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
        title={t('events.score')}
      >
        {event.MaxScore}
      </span>
    </div>
  );
}
