import { getEventImageUrl } from '../../api/events';

// The chain shape is declared here, next to the code that resolves it, so this
// module and lib/assistant do not import the settings store (refs #281).
export type ThumbnailFallbackType = 'alarm' | 'snapshot' | 'objdetect' | 'custom';

export interface ThumbnailFallbackEntry {
  type: ThumbnailFallbackType;
  enabled: boolean;
  customFid?: string;
}

export interface ThumbnailChainOptions {
  token?: string;
  width?: number;
  height?: number;
  apiUrl?: string;
  minStreamingPort?: number;
  monitorId?: string;
  /**
   * Whether this event has an alarm frame at all. When false the `alarm`
   * candidate is dropped instead of requested (refs #331): ZoneMinder answers
   * 404 for an alarm frame that was never recorded, and the chain only falls
   * through to `snapshot` after the browser reports that failure. One list of
   * events therefore costs one 404 per event, which reads to a reverse proxy
   * as an attack; one reporter was IP-banned by their own proxy for it.
   *
   * Omit it when the caller has no event record to consult, such as a push
   * notification: the alarm candidate is then kept and behaviour is unchanged.
   */
  hasAlarmFrame?: boolean;
}

/** The event fields this module needs. Kept structural so callers can pass an
 *  `Event`, a timeline row, or a notification payload without converting. */
interface AlarmFrameCountLike {
  AlarmFrames?: string | number | null;
}

/**
 * Whether ZoneMinder recorded an alarm frame for this event.
 *
 * `AlarmFrames` is a required field on `EventSchema`, so it rides along with
 * every list response already; this costs no extra request. An absent or
 * unparsable count returns true, because a wasted request is cheaper than
 * silently dropping the alarm thumbnail of an event that does have one.
 *
 * Note this is the count, not `AlarmFrameId`: that field is optional on the
 * schema and missing from some servers' list responses, so branching on it
 * would skip alarm frames for events that really have them.
 */
export function eventHasAlarmFrame(event: AlarmFrameCountLike): boolean {
  const parsed = Number(event.AlarmFrames);
  if (!Number.isFinite(parsed)) return true;
  if (event.AlarmFrames === '' || event.AlarmFrames === null) return true;
  return parsed > 0;
}

export function resolveFallbackFids(
  chain: ThumbnailFallbackEntry[] | undefined,
  options: Pick<ThumbnailChainOptions, 'hasAlarmFrame'> = {}
): string[] {
  const fids: string[] = [];
  if (!Array.isArray(chain)) return fids;
  for (const entry of chain) {
    if (!entry.enabled) continue;
    if (entry.type === 'alarm' && options.hasAlarmFrame === false) continue;
    if (entry.type === 'custom') {
      const fid = entry.customFid?.trim();
      if (fid) fids.push(fid);
      continue;
    }
    fids.push(entry.type);
  }
  return fids;
}

export function buildThumbnailChain(
  portalUrl: string,
  eventId: string,
  chain: ThumbnailFallbackEntry[] | undefined,
  options: ThumbnailChainOptions = {}
): string[] {
  return resolveFallbackFids(chain, options).map((fid) =>
    getEventImageUrl(portalUrl, eventId, fid, options)
  );
}
