/**
 * Result cards for events/monitors a tool found (refs #246).
 *
 * Rendered by AskPanel below a `role: 'tool'` message that carried a
 * `display` array (see lib/assistant/agent.ts's `runAssistantTurn` and
 * lib/assistant/display.ts's builders). Purely presentational: images
 * (`EventThumbnail`) are for the user only and never touch the model, and
 * "Open" just calls the host's `navigate`, which closes the palette and
 * routes (see useAssistantHost.ts).
 *
 * Monitor cards carry a LIVE preview (refs #264) when the answer is about a
 * few monitors; above `ASSISTANT.maxLiveMonitorCards` they fall back to
 * text, since each preview is a real stream with real cost.
 *
 * Event cards hover (long-press on mobile) into ZMS playback through the same
 * `HoverPreview` + `EventZmsHoverPlayer` pair the events list uses, so the
 * stream gets a fresh connkey on open and a CMD_QUIT on close (refs #270).
 */
import { useTranslation } from 'react-i18next';
import { EventThumbnail } from '../events/EventThumbnail';
import { HoverPreview } from '../ui/hover-preview';
import { EventZmsHoverPlayer } from '../events/EventThumbnailHoverPreview';
import { LiveMonitorPlayer } from '../monitors/LiveMonitorPlayer';
import { useMonitors } from '../../hooks/useMonitors';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { Button } from '../ui/button';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import type { AssistantHost, DisplayEntity } from '../../lib/assistant/types';

export interface AssistantResultCardsProps {
  entities: DisplayEntity[];
  host: AssistantHost;
}

export function AssistantResultCards({ entities, host }: AssistantResultCardsProps) {
  const { t } = useTranslation();
  // The shared monitors query (cached, bandwidth-managed polling): cards only
  // READ it to resolve a card's monitor id to the stream-capable Monitor
  // object; no extra requests when the cache is warm.
  const { monitors } = useMonitors();
  const { currentProfile, settings } = useCurrentProfile();
  const monitorCardCount = entities.filter((e) => e.kind === 'monitor').length;
  const livePreviews = monitorCardCount > 0 && monitorCardCount <= ASSISTANT.maxLiveMonitorCards;

  return (
    <div className="flex flex-wrap gap-2" data-testid="assistant-result-cards">
      {entities.map((entity) => {
        const open = () => host.navigate(entity.navigatePath);
        const liveMonitor =
          entity.kind === 'monitor' && livePreviews
            ? monitors.find((m) => m.Monitor.Id === entity.id)?.Monitor
            : undefined;
        // Set only when this card can actually stream: an event card, previews
        // enabled for this surface, and a monitor to resolve the ZMS port with.
        const hoverMonitorId =
          entity.kind === 'event' && settings.hoverPreview.assistant ? entity.monitorId : undefined;
        const thumbnail = (
          <EventThumbnail
            urls={entity.imageUrls ?? []}
            cacheKey={entity.cacheKey ?? entity.id}
            alt={entity.title}
            className="h-full w-full"
            objectFit="cover"
            loading="lazy"
            data-testid="assistant-card-thumbnail"
          />
        );
        return (
          <div
            key={`${entity.kind}-${entity.id}`}
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            }}
            data-testid={`assistant-card-${entity.kind}`}
            className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-md border border-border/60 bg-background p-2 text-left cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary sm:w-64"
          >
            {liveMonitor && (
              <div
                className="h-14 w-24 shrink-0 overflow-hidden rounded bg-card border border-border/40"
                data-testid="assistant-card-monitor-live"
              >
                <LiveMonitorPlayer
                  monitor={liveMonitor}
                  profile={currentProfile}
                  className="h-full w-full"
                  objectFit="cover"
                  muted
                />
              </div>
            )}
            {entity.kind === 'event' && (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-card border border-border/40">
                {hoverMonitorId ? (
                  <HoverPreview
                    aspectRatio={16 / 9}
                    testId="event-thumbnail-hover-preview"
                    renderPreview={() => (
                      <EventZmsHoverPlayer
                        descriptor={{ eventId: entity.id, monitorId: hoverMonitorId, name: entity.title }}
                      />
                    )}
                  >
                    {thumbnail}
                  </HoverPreview>
                ) : (
                  thumbnail
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={entity.title}>
                {entity.title}
              </p>
              {entity.subtitle && (
                <p className="truncate text-[11px] text-muted-foreground" title={entity.subtitle}>
                  {entity.subtitle}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              data-testid="assistant-card-open"
            >
              {t('assistant.card.open')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
