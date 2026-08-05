import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeatmapWidget } from '../HeatmapWidget';
import { useProfileScope } from '../../../../hooks/useProfileScope';
import { useBandwidthSettings } from '../../../../hooks/useBandwidthSettings';
import { getSession } from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { asProfileId } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
  // EventHeatmap (rendered when there's data) uses the real useDateTimeFormat,
  // which pulls in useCurrentProfile -> stores/profile.ts, which calls this
  // at module load time.
  registerSessionsGate: vi.fn(),
}));
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));
// recharts (via EventHeatmap) isn't exercised by these scenarios - the error
// and empty states both return before the chart mounts - but stub it anyway
// so jsdom never has to lay out a real chart.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home', timezone: 'UTC' };
const profileB = { id: asProfileId('profile-b'), name: 'Work', timezone: 'UTC' };

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../../api/client').ApiClient;
}

function mockScope(profiles: Array<typeof profileA>) {
  const mode = profiles.length > 1 ? 'all' : 'single';
  vi.mocked(useProfileScope).mockReturnValue({
    mode,
    profile: mode === 'single' ? profiles[0] : null,
    profiles,
    settings: {},
  } as never);
}

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HeatmapWidget />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HeatmapWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBandwidthSettings).mockReturnValue({ timelineHeatmapInterval: 60000 } as never);
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: clientFor(id),
      timezone: 'UTC',
    }));
  });

  it('single profile erroring with zero data shows the error branch, not the empty state (refs #337)', async () => {
    mockScope([profileA]);
    vi.mocked(getEvents).mockRejectedValue(new Error('boom'));

    renderWidget();

    await waitFor(() => expect(screen.getByText(/common\.error/)).toBeInTheDocument());
    expect(screen.queryByText('events.no_events')).toBeNull();
  });

  it('one profile erroring while another has data renders the data, not the error branch (zero-data suppression)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const id = (client as unknown as { profile: string }).profile;
      if (id === profileA.id) throw new Error('boom');
      return { events: [{ Event: { Id: '1', StartDateTime: '2026-08-03 10:00:00' } }] } as never;
    });

    renderWidget();

    await waitFor(() => expect(screen.queryByText('common.error')).toBeNull());
    expect(screen.queryByText('events.no_events')).toBeNull();
  });

  it('all profiles empty (no error) still shows the empty state', async () => {
    mockScope([profileA]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    renderWidget();

    await waitFor(() => expect(screen.getByText('events.no_events')).toBeInTheDocument());
  });
});
