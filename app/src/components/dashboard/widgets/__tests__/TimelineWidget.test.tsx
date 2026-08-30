import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { TimelineWidget } from '../TimelineWidget';
import { getEvents } from '../../../../api/events';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';

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
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));

const profileA = makeProfile('profile-a', { name: 'Home' });

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
    // profileA defaults to bandwidthMode 'normal', whose real
    // getBandwidthSettings() gives timelineHeatmapInterval 60000 - the same
    // value the old mock hardcoded.
    seedProfiles([profileA]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('single profile erroring with zero data shows the error branch instead of the chart (refs #337)', async () => {
    vi.mocked(getEvents).mockRejectedValue(new Error('boom'));

    renderWidget();

    await waitFor(() => expect(screen.getByText(/common\.error/)).toBeInTheDocument());
  });

  it('resolved data with no errors renders the chart, not the error branch', async () => {
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    renderWidget();

    await waitFor(() => expect(getEvents).toHaveBeenCalled());
    expect(screen.queryByText('common.error')).toBeNull();
  });
});
