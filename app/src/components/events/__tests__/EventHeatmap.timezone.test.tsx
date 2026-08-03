/**
 * Regression test (refs #337): EventHeatmap must bucket by the OWNING
 * profile's real chronological instant (eventInstant), not a naive local
 * Date parse of the server wall-clock string. Two profiles in different
 * timezones reporting the SAME wall-clock StartDateTime happened at
 * different real instants and must land in different hour buckets.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventHeatmap } from '../EventHeatmap';
import type { EventData } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { count?: number } | string) => (typeof opts === 'string' ? opts : k) }),
}));
vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDate: (d: Date) => String(d.getTime()), fmtTimeShort: (d: Date) => String(d.getTime()) }),
}));

function event(id: string, startDateTime: string): EventData {
  return {
    Event: { Id: id, Name: `Event-${id}`, StartDateTime: startDateTime, Cause: 'Motion', Length: '10', Notes: '' },
  } as EventData;
}

describe('EventHeatmap - owning-profile timezone buckets (refs #337)', () => {
  it('same wall-clock time from two different-timezone profiles lands in two different hour buckets', () => {
    render(
      <EventHeatmap
        events={[
          { item: event('1', '2026-06-15 06:00:00'), timezone: 'UTC' },
          // America/New_York is UTC-4 in June (DST): same wall clock, 4h
          // different real instant.
          { item: event('2', '2026-06-15 06:00:00'), timezone: 'America/New_York' },
        ]}
        startDate={new Date('2026-06-15T00:00:00Z')}
        endDate={new Date('2026-06-16T00:00:00Z')}
        collapsible={false}
        showCard={false}
      />
    );

    const buckets = screen.getAllByRole('button');
    const counts = buckets.map((b) => Number(b.getAttribute('aria-label')?.match(/:\s*(\d+)/)?.[1] ?? 0));

    // Both events counted (both fall inside the 24h span)...
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    // ...but split across two different hour buckets, never doubled into one.
    expect(Math.max(...counts)).toBe(1);
  });
});
