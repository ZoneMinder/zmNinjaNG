import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventsWidget } from '../EventsWidget';
import { useProfileScope } from '../../../../hooks/useProfileScope';
import { useBandwidthSettings } from '../../../../hooks/useBandwidthSettings';
import { getSession } from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { asProfileId } from '../../../../api/types';
import type { EventData } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: () => '2:19 PM' }),
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
  // useEventTagMapping (real, transitively pulled in via useEventTags) is
  // imported through hooks/useCurrentProfile -> stores/profile.ts, which
  // calls this at module load time - the mock must define it even though
  // this test never exercises the tag-fetch path.
  registerSessionsGate: vi.fn(),
}));
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home', timezone: 'UTC' };
const profileB = { id: asProfileId('profile-b'), name: 'Work', timezone: 'UTC' };

function event(id: string, name: string, startDateTime: string): EventData {
  return {
    Event: {
      Id: id,
      Name: name,
      StartDateTime: startDateTime,
      Cause: 'Motion',
      Length: '10',
      Notes: '',
    },
  } as EventData;
}

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../../api/client').ApiClient;
}

function mockScope(profiles: Array<typeof profileA>, mode?: 'single' | 'all') {
  const resolvedMode = mode ?? (profiles.length > 1 ? 'all' : 'single');
  vi.mocked(useProfileScope).mockReturnValue({
    mode: resolvedMode,
    profile: resolvedMode === 'single' ? profiles[0] : null,
    profiles,
    settings: {},
  } as never);
}

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventsWidget />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EventsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBandwidthSettings).mockReturnValue({ eventsWidgetInterval: 30000 } as never);
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: clientFor(id),
      timezone: 'UTC',
    }));
  });

  // profiles.length > 1 as the All-mode signal breaks the moment a delete
  // brings the scope down to one profile while still IN All mode (mode
  // stays 'all', but the count-based heuristic silently flips to single-mode
  // behavior): chips disappear and links stop deep-linking through /all
  // (refs #337, final fix wave).
  it('a single remaining profile in All mode still chips and deep-links via /all (refs #337)', async () => {
    mockScope([profileA], 'all');
    vi.mocked(getEvents).mockResolvedValue({
      events: [event('1', 'Front Door A', '2026-08-03 10:00:00')],
    } as never);

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<EventsWidget />} />
            <Route path="/all/events/:profileId/:eventId" element={<div data-testid="landed-all-route" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('Front Door A')).toBeInTheDocument());
    expect(screen.getByTestId('widget-profile-chip')).toHaveTextContent('Home');

    fireEvent.click(screen.getByText('Front Door A'));
    expect(screen.getByTestId('landed-all-route')).toBeInTheDocument();
  });

  it('All mode: aggregates both profiles\' events with a profile chip per row (refs #337)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const id = (client as unknown as { profile: string }).profile;
      return (id === profileA.id
        ? { events: [event('1', 'Front Door A', '2026-08-03 10:00:00')] }
        : { events: [event('1', 'Back Yard B', '2026-08-03 11:00:00')] }) as never;
    });

    renderWidget();

    await waitFor(() => expect(screen.getByText('Front Door A')).toBeInTheDocument());
    expect(screen.getByText('Back Yard B')).toBeInTheDocument();

    const chips = screen.getAllByTestId('widget-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(expect.arrayContaining(['Home', 'Work']));
  });

  it('single mode: no chip, exact single-profile query', async () => {
    mockScope([profileA]);
    vi.mocked(getEvents).mockResolvedValue({
      events: [event('9', 'Solo Event', '2026-08-03 09:00:00')],
      pagination: { totalCount: 1 },
    } as never);

    renderWidget();

    await waitFor(() => expect(screen.getByText('Solo Event')).toBeInTheDocument());
    expect(screen.queryByTestId('widget-profile-chip')).toBeNull();
    expect(getSession).toHaveBeenCalledWith(profileA.id);
  });

  it('does not throw when rendered under the All-mode sentinel with zero events yet', () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);

    expect(() => renderWidget()).not.toThrow();
  });

  it('single profile erroring with zero data shows the error branch, not the empty state (refs #337)', async () => {
    mockScope([profileA]);
    vi.mocked(getEvents).mockRejectedValue(new Error('boom'));

    renderWidget();

    await waitFor(() => expect(screen.getByText(/common\.error/)).toBeInTheDocument());
    expect(screen.queryByText('dashboard.no_recent_events')).toBeNull();
  });
});
