/**
 * Regression test (refs #337): TimelineWidget's hour buckets must use the
 * OWNING profile's real chronological instant (eventInstant), not a naive
 * local Date parse of the server wall-clock string. Two profiles in
 * different timezones reporting the SAME wall-clock StartDateTime happened
 * at different real instants and must land in different hour buckets - a
 * naive parse collapses them into the same bucket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimelineWidget } from '../TimelineWidget';
import { useProfileScope } from '../../../../hooks/useProfileScope';
import { useBandwidthSettings } from '../../../../hooks/useBandwidthSettings';
import { getSession } from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { asProfileId } from '../../../../api/types';
import type { EventData } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../theme-provider', () => ({
  useTheme: () => ({ theme: 'light' }),
}));
// Capture the chart's bucketed `data` prop directly instead of rendering
// actual bars - the bucket COUNTS are what this test cares about.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ data }: { data: Array<{ count: number }> }) => (
    <div data-testid="chart-buckets">{JSON.stringify(data.map((d) => d.count))}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));
vi.mock('../../../../hooks/useBandwidthSettings', () => ({
  useBandwidthSettings: vi.fn(),
}));
vi.mock('../../../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(),
  registerSessionsGate: vi.fn(),
}));
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));

// UTC and America/New_York differ by 4h in June (both DST-observing at that
// date), so the same wall-clock string resolves 4h apart in real instant.
const profileA = { id: asProfileId('profile-a'), name: 'Home', timezone: 'UTC' };
const profileB = { id: asProfileId('profile-b'), name: 'Work', timezone: 'America/New_York' };

function event(id: string, startDateTime: string): EventData {
  return {
    Event: { Id: id, Name: `Event-${id}`, StartDateTime: startDateTime, Cause: 'Motion', Length: '10', Notes: '' },
  } as EventData;
}

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../../api/client').ApiClient;
}

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TimelineWidget />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TimelineWidget - owning-profile timezone buckets (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    vi.mocked(useBandwidthSettings).mockReturnValue({ timelineHeatmapInterval: 60000 } as never);
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', profile: null, profiles: [profileA, profileB], settings: {},
    } as never);
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id, client: clientFor(id), timezone: 'UTC',
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('same wall-clock time from two different-timezone profiles lands in two different hour buckets', async () => {
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const id = (client as unknown as { profile: string }).profile;
      return { events: [event(id === profileA.id ? '1' : '2', '2026-06-15 06:00:00')] } as never;
    });

    renderWidget();

    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2));
    const bucketsJson = await screen.findByTestId('chart-buckets');
    const counts: number[] = JSON.parse(bucketsJson.textContent ?? '[]');

    // Both events counted (24h window covers both real instants)...
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    // ...but split across two different hour buckets, never doubled into one.
    expect(Math.max(...counts)).toBe(1);
  });
});
