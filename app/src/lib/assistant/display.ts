/**
 * Builds `DisplayEntity` result cards for the read-only assistant tools
 * (refs #246). Split out of tools-readonly.ts to keep that file under the
 * ~400 LOC guideline (rule 12) and because both list_events/get_event and
 * list_monitors/get_monitor share one builder each.
 *
 * Event thumbnail URLs are built exactly like MonitorRecentEvents.tsx builds
 * them for CompactEventRow: `getPortalUrlForEvent` resolves the event's
 * monitor to its (possibly multi-server) portal URL, then
 * `buildThumbnailChain` maps the profile's configured fallback chain
 * (alarm/snapshot/objdetect/custom) to authenticated image URLs via
 * `getEventImageUrl` (api/events.ts). These URLs are UI-only: they land on
 * `DisplayEntity.imageUrls`, never on the JSON `output` string a tool hands
 * back to the model (the vision non-goal stands).
 */
import type { Event, MonitorData } from '../../api/types';
import { getPortalUrlForEvent } from '../zm/server-resolver';
import { buildThumbnailChain } from '../event/thumbnail-chain';
import { parseDetectedObjects } from '../event/event-detection';
import { formatAppDateTimeShort } from '../format-date-time';
import type { DisplayEntity, ToolContext } from './types';

type EventLike = Pick<Event, 'Id' | 'MonitorId' | 'StartDateTime' | 'Notes' | 'Cause'>;

/** Builds one event result card. `monitorName` is already resolved by the
 *  caller (list_events/get_event both build a monitor id -> name map for the
 *  text output; this reuses it instead of looking it up again). */
export function buildEventDisplayEntity(
  e: EventLike,
  monitorName: string,
  monitors: MonitorData[],
  ctx: ToolContext,
): DisplayEntity {
  const objects = parseDetectedObjects(e.Notes);
  const startTime = new Date(e.StartDateTime.replace(' ', 'T'));
  const startLabel = ctx.dateTimeFormat
    ? formatAppDateTimeShort(startTime, ctx.dateTimeFormat)
    : e.StartDateTime;

  let imageUrls: string[] = [];
  if (ctx.portalUrl) {
    const eventPortalUrl = getPortalUrlForEvent(e.MonitorId, monitors, ctx.portalUrl);
    imageUrls = buildThumbnailChain(eventPortalUrl, e.Id, ctx.thumbnailFallbackChain, {
      token: ctx.accessToken ?? undefined,
      minStreamingPort: ctx.minStreamingPort,
      monitorId: e.MonitorId,
    });
  }

  return {
    kind: 'event',
    id: e.Id,
    title: `${monitorName} · ${startLabel}`,
    subtitle: objects.length > 0 ? objects.join(', ') : e.Cause,
    navigatePath: `/events/${e.Id}`,
    imageUrls,
    cacheKey: e.Id,
  };
}

/** Builds one monitor result card. No snapshot image (rule: do not wire a
 *  live stream or build one here); AskPanel renders the card text-only. */
export function buildMonitorDisplayEntity(m: MonitorData): DisplayEntity {
  const status = m.Monitor_Status?.Status;
  return {
    kind: 'monitor',
    id: m.Monitor.Id,
    title: m.Monitor.Name,
    subtitle: status ? `${m.Monitor.Function} · ${status}` : m.Monitor.Function,
    navigatePath: `/monitors/${m.Monitor.Id}`,
  };
}
