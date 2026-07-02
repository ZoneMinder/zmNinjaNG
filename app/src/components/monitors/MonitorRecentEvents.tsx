/**
 * Recent-events list under the live view on the monitor detail page.
 * Always-visible header (title, refresh, collapse, "All events"). The body is
 * collapsible per monitor; while collapsed the query is disabled (refs #213).
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { CompactEventRow } from '../events/CompactEventRow';
import { useMonitorRecentEvents } from '../../hooks/useMonitorRecentEvents';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/multiport';
import { getPortalUrlForEvent } from '../../lib/server-resolver';
import { buildThumbnailChain } from '../../lib/thumbnail-chain';
import {
  calculateThumbnailDimensions,
  getMonitorDimensions,
  EVENT_GRID_CONSTANTS,
} from '../../lib/event-utils';
import type { Event, Monitor } from '../../api/types';

interface MonitorRecentEventsProps {
  monitor: Monitor;
}

export function MonitorRecentEvents({ monitor }: MonitorRecentEventsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile, settings } = useCurrentProfile();
  const { token: accessToken, isFresh } = useFreshAccessToken();
  const monitorId = monitor.Id;
  const { events, isLoading, isError, isFetching, hidden, toggleHidden, refetch } =
    useMonitorRecentEvents(monitorId);

  const portalUrl = currentProfile?.portalUrl || '';
  const thumbnailChain = settings.thumbnailFallbackChain;
  const thumbnailFit = settings.eventsThumbnailFit === 'fill' ? 'contain' : settings.eventsThumbnailFit;
  const minStreamingPort = resolveMinStreamingPort(
    currentProfile?.minStreamingPort,
    settings.forceDisableMultiPort
  );
  const monitorsForResolve = [{ Monitor: monitor }];

  const buildRow = (ev: Event) => {
    const { width, height } = getMonitorDimensions(monitor, ev.Width, ev.Height);
    const { width: tw, height: th } = calculateThumbnailDimensions(
      width,
      height,
      monitor.Orientation ?? ev.Orientation,
      EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
    );
    const eventPortalUrl = getPortalUrlForEvent(ev.MonitorId, monitorsForResolve, portalUrl);
    const urls = buildThumbnailChain(eventPortalUrl, ev.Id, thumbnailChain, {
      token: isFresh ? accessToken ?? undefined : undefined,
      width: tw,
      height: th,
      minStreamingPort,
      monitorId: ev.MonitorId,
    });
    return { urls, aspectRatio: tw / th };
  };

  return (
    <div className="w-full max-w-5xl mt-4 px-2" data-testid="monitor-recent-events">
      <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
        <button
          type="button"
          onClick={toggleHidden}
          className="flex items-center gap-1.5 text-sm font-medium min-w-0"
          aria-expanded={!hidden}
          data-testid="monitor-recent-events-toggle"
        >
          {hidden ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="truncate">{t('monitor_detail.recent_events')}</span>
        </button>
        <div className="flex items-center gap-1">
          {!hidden && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refetch}
              disabled={isFetching}
              title={t('monitor_detail.refresh_events')}
              aria-label={t('monitor_detail.refresh_events')}
              data-testid="monitor-recent-events-refresh"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate(`/events?monitorId=${monitorId}`)}
            data-testid="monitor-recent-events-all"
          >
            {t('monitor_detail.all_events')}
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </div>

      {!hidden && (
        <div className="pt-2" data-testid="monitor-recent-events-body">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-xs text-destructive py-2">
              <AlertCircle className="h-4 w-4" />
              {t('common.error')}
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              {t('monitor_detail.no_recent_events')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {events.map(({ Event: ev }) => {
                const { urls, aspectRatio } = buildRow(ev);
                return (
                  <CompactEventRow
                    key={ev.Id}
                    event={ev}
                    thumbnailUrls={urls}
                    aspectRatio={aspectRatio}
                    objectFit={thumbnailFit}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
