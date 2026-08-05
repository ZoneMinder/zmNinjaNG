/**
 * Composite key for per-event state that has to survive All mode.
 *
 * Event ids are only unique within one ZoneMinder server, so two profiles
 * pointed at independent servers routinely produce the same numeric id.
 * Anything keyed by a bare event id (tag lookups, row keys, caches) merges
 * two different events into one entry once more than one profile is in
 * scope - the same class of defect `monitorCacheKey` exists for on the
 * monitor side (refs #337).
 *
 * The profileId is optional, and omitting it returns the bare event id, so
 * single-mode callers - which carry no profileId on their rows - keep the
 * exact keys they had before.
 */

import type { ProfileId } from '../../api/types';

export function scopedEventKey(profileId: ProfileId | null | undefined, eventId: string): string {
  return profileId ? `${profileId}:${eventId}` : eventId;
}
