import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { HeatmapWidget } from '../HeatmapWidget';
import * as sessions from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { ALL_PROFILES_ID } from '../../../../api/types';
import type { Profile } from '../../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

// Real profile store + real session registry; distinct client instances per
// profile so a by-reference branch on the (kept-mocked) getEvents can tell
// them apart, matching the sanctioned "script the HTTP boundary" pattern.
function seedScope(profiles: Profile[]) {
  const mode = profiles.length > 1 ? 'all' : 'single';
  seedProfiles(profiles, { current: mode === 'all' ? ALL_PROFILES_ID : profiles[0].id });
  for (const p of profiles) installApiClient(p.id, fakeApiClient());
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
    // Every seeded profile below defaults to bandwidthMode 'normal', whose
    // real getBandwidthSettings() gives timelineHeatmapInterval 60000 - the
    // same value the old mock hardcoded.
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('single profile erroring with zero data shows the error branch, not the empty state (refs #337)', async () => {
    seedScope([profileA]);
    vi.mocked(getEvents).mockRejectedValue(new Error('boom'));

    renderWidget();

    await waitFor(() => expect(screen.getByText(/common\.error/)).toBeInTheDocument());
    expect(screen.queryByText('events.no_events')).toBeNull();
  });

  it('one profile erroring while another has data renders the data, not the error branch (zero-data suppression)', async () => {
    seedScope([profileA, profileB]);
    const clientA = sessions.getSession(profileA.id).client;
    vi.mocked(getEvents).mockImplementation(async (client) => {
      if (client === clientA) throw new Error('boom');
      return { events: [{ Event: { Id: '1', StartDateTime: '2026-08-03 10:00:00' } }] } as never;
    });

    renderWidget();

    await waitFor(() => expect(screen.queryByText('common.error')).toBeNull());
    expect(screen.queryByText('events.no_events')).toBeNull();
  });

  it('all profiles empty (no error) still shows the empty state', async () => {
    seedScope([profileA]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    renderWidget();

    await waitFor(() => expect(screen.getByText('events.no_events')).toBeInTheDocument());
  });
});
