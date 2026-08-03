import { describe, expect, it } from 'vitest';
import { eventInstant } from '../event-instant';
import type { EventData } from '../../../api/types';

function event(startDateTime: string): EventData {
  return { Event: { StartDateTime: startDateTime } } as EventData;
}

describe('eventInstant', () => {
  it('orders two events with the SAME wall-clock string by their true absolute instant, not the string', () => {
    // Profile A (UTC) and profile B (America/New_York, EST in January, UTC-5)
    // both stamp an event "2026-01-15 10:00:00". B's 10:00 EST is 15:00 UTC -
    // five hours after A's 10:00 UTC - so B happened later in reality even
    // though the two strings are identical.
    const utcInstant = eventInstant(event('2026-01-15 10:00:00'), 'UTC');
    const nyInstant = eventInstant(event('2026-01-15 10:00:00'), 'America/New_York');

    expect(nyInstant).toBeGreaterThan(utcInstant);
    expect(nyInstant - utcInstant).toBe(5 * 60 * 60 * 1000);
  });

  it('interleaves correctly across two timezones once ordered by instant', () => {
    // A (UTC) event at 14:00 and B (America/New_York) event at 10:00 the same
    // day: B's 10:00 EST = 15:00 UTC, so B is actually the LATER event even
    // though its wall-clock hour reads earlier.
    const a = { profile: 'A', instant: eventInstant(event('2026-01-15 14:00:00'), 'UTC') };
    const b = { profile: 'B', instant: eventInstant(event('2026-01-15 10:00:00'), 'America/New_York') };

    const ordered = [a, b].sort((x, y) => y.instant - x.instant).map((e) => e.profile);
    expect(ordered).toEqual(['B', 'A']);
  });

  it('accounts for the US spring-forward DST boundary (America/New_York, 2026-03-08)', () => {
    // Clocks jump 02:00 -> 03:00 on 2026-03-08. 01:30 is still EST (-05:00);
    // 03:30 is already EDT (-04:00). The wall-clock gap reads as 2 hours but
    // only 1 real hour elapses.
    const before = eventInstant(event('2026-03-08 01:30:00'), 'America/New_York');
    const after = eventInstant(event('2026-03-08 03:30:00'), 'America/New_York');

    expect(after - before).toBe(60 * 60 * 1000);
  });
});
