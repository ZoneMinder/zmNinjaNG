/**
 * Result cards for events/monitors a tool found (refs #246).
 *
 * Rendered by AskPanel below a `role: 'tool'` message that carried a
 * `display` array (see lib/assistant/agent.ts's `runAssistantTurn` and
 * lib/assistant/display.ts's builders). Purely presentational: images
 * (`EventThumbnail`) are for the user only and never touch the model, and
 * "Open" just calls the host's `navigate`, which closes the palette and
 * routes (see useAssistantHost.ts).
 */
import { useTranslation } from 'react-i18next';
import { EventThumbnail } from '../events/EventThumbnail';
import { Button } from '../ui/button';
import type { AssistantHost, DisplayEntity } from '../../lib/assistant/types';

export interface AssistantResultCardsProps {
  entities: DisplayEntity[];
  host: AssistantHost;
}

export function AssistantResultCards({ entities, host }: AssistantResultCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2" data-testid="assistant-result-cards">
      {entities.map((entity) => {
        const open = () => host.navigate(entity.navigatePath);
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
            {entity.kind === 'event' && (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-card border border-border/40">
                <EventThumbnail
                  urls={entity.imageUrls ?? []}
                  cacheKey={entity.cacheKey ?? entity.id}
                  alt={entity.title}
                  className="h-full w-full"
                  objectFit="cover"
                  loading="lazy"
                  data-testid="assistant-card-thumbnail"
                />
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
