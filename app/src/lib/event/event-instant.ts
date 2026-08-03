/**
 * Absolute-instant ordering for events across profiles.
 *
 * ZoneMinder returns event timestamps as server-local wall-clock strings
 * ('YYYY-MM-DD HH:mm:ss') with no offset. Merging events fetched from two
 * profiles on different servers/timezones by that string alone orders them
 * by wall clock, not by when they actually happened - a New York event
 * stamped 10:00 and a UTC event stamped 10:00 are five hours apart in
 * reality. This derives the real epoch instant using the OWNING profile's
 * timezone, via date-fns-tz's fromZonedTime (already used for the same
 * server-local-string problem in lib/assistant/event-range.ts), so
 * useScopedEvents can sort merged events by true chronological order.
 */
import { fromZonedTime } from 'date-fns-tz';
import type { EventData } from '../../api/types';

/**
 * Epoch ms an event's StartDateTime represents, interpreted as wall-clock
 * time in `timezone` (the OWNING profile's IANA zone, e.g. the `timezone`
 * field off `getSession(profileId)` or `Profile.timezone`).
 */
export function eventInstant(event: EventData, timezone: string): number {
  return fromZonedTime(event.Event.StartDateTime.replace(' ', 'T'), timezone).getTime();
}
