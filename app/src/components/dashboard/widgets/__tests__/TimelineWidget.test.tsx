import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimelineWidget } from '../TimelineWidget';
import { useProfileScope } from '../../../../hooks/useProfileScope';
import { useBandwidthSettings } from '../../../../hooks/useBandwidthSettings';
import { getSession } from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { asProfileId } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../theme-provider', () => ({
  useTheme: () => ({ theme: 'light' }),
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

const profileA = { id: asProfileId('profile-a'), name: 'Home', timezone: 'UTC' };

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../../api/client').ApiClient;
}

function mockScope(profiles: Array<typeof profileA>) {
  vi.mocked(useProfileScope).mockReturnValue({
    mode: 'single',
    profile: profiles[0],
    profiles,
    settings: {},
  } as never);
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

describe('TimelineWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBandwidthSettings).mockReturnValue({ timelineHeatmapInterval: 60000 } as never);
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: clientFor(id),
      timezone: 'UTC',
    }));
  });

  it('single profile erroring with zero data shows the error branch instead of the chart (refs #337)', async () => {
    mockScope([profileA]);
    vi.mocked(getEvents).mockRejectedValue(new Error('boom'));

    renderWidget();

    await waitFor(() => expect(screen.getByText(/common\.error/)).toBeInTheDocument());
  });

  it('resolved data with no errors renders the chart, not the error branch', async () => {
    mockScope([profileA]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    renderWidget();

    await waitFor(() => expect(getEvents).toHaveBeenCalled());
    expect(screen.queryByText('common.error')).toBeNull();
  });
});
