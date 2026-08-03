import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import Events from '../Events';
import { ALL_PROFILES_ID } from '../../api/types';

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: (string | object)[] }) => useQueryMock(options),
  keepPreviousData: (previousData: unknown) => previousData,
}));

const useScopedEventsMock = vi.fn();
const useScopedMonitorsMock = vi.fn();
const useProfileScopeMock = vi.fn();

vi.mock('../../hooks/useScopedEvents', () => ({
  useScopedEvents: (options: unknown) => useScopedEventsMock(options),
}));
vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => useScopedMonitorsMock(),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: () => useProfileScopeMock(),
}));

// Mutable so All-mode tests can flip isAllMode (real useCurrentProfile/
// useCurrentProfile.isAllMode compares this against ALL_PROFILES_ID) - a
// SEPARATE signal from the useProfileScope mock below, and Events.tsx reads
// both, so tests must set both together (see allScope()/singleScope()).
let mockCurrentProfileId = 'profile-1';

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string }) => unknown) =>
    selector({ currentProfileId: mockCurrentProfileId }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: (
    selector: (state: {
      accessToken: string;
      accessTokenExpires: number;
      isAuthenticated: boolean;
      getFreshAccessToken: () => Promise<string | null>;
    }) => unknown,
  ) =>
    selector({
      accessToken: 'token-1',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      isAuthenticated: true,
      getFreshAccessToken: vi.fn(async () => 'token-1'),
    }),
  useAuthSlice: () => ({
    accessToken: 'token-1',
    accessTokenExpires: Date.now() + 60 * 60 * 1000,
    isAuthenticated: true,
    requiresAuth: true,
  }),
}));

const updateProfileSettingsMock = vi.fn();
let settingsOverrides: Record<string, unknown> = {};

vi.mock('../../stores/settings', () => {
  const DEFAULT_SETTINGS = {
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'light',
    defaultEventLimit: 50,
    eventsViewMode: 'list',
    eventMontageByGroup: { '__all__': { gridCols: 3 } },
    excludedMonitorIds: [],
    eventsServerFilter: null,
  };
  return {
    ALL_GROUPS_KEY: '__all__',
    DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT: { gridCols: 3 },
    DEFAULT_SETTINGS,
    mergeProfileSettings: (raw: Record<string, unknown> | undefined) => ({ ...DEFAULT_SETTINGS, ...raw, ...settingsOverrides }),
    useSettingsStore: (selector: (state: { getProfileSettings: (id: string) => { defaultEventLimit: number; eventsViewMode: 'list'; eventMontageByGroup: Record<string, { gridCols: number }> }; updateProfileSettings: (...args: unknown[]) => void; updateEventMontageGroupLayout: () => void }) => unknown) =>
      selector({
        getProfileSettings: () => ({ defaultEventLimit: 50, eventsViewMode: 'list', eventMontageByGroup: { '__all__': { gridCols: 3 } }, excludedMonitorIds: [] }),
        updateProfileSettings: updateProfileSettingsMock,
        updateEventMontageGroupLayout: vi.fn(),
      }),
  };
});

const applyFilters = vi.fn();
const clearFilters = vi.fn();
const clearDateRange = vi.fn();

// Mutable per-test overrides for the fields the clear-date-range render condition
// depends on (startDateInput / endDateInput / activeQuickRange). A monitor card's
// Events link deep-links to ?monitorId=<id>&startDateTime=<watermark>, which
// useEventFilters hydrates into startDateInput with activeQuickRange left null
// (see the "hydrates startDateInput from a deep-linked date" test in
// hooks/__tests__/useEventFilters.test.ts, which covers that hydration against the
// real hook). Controlling the three fields directly here exercises the same
// downstream state without re-parsing a URL through this file's other mocks.
let eventFiltersOverrides: {
  startDateInput?: string;
  endDateInput?: string;
  activeQuickRange?: number | null;
} = {};

vi.mock('../../hooks/useEventFilters', () => ({
  ALL_TAGS_FILTER_ID: '__all_tags__',
  useEventFilters: () => ({
    filters: {},
    selectedMonitorIds: [],
    selectedTagIds: [],
    startDateInput: '',
    endDateInput: '',
    favoritesOnly: false,
    activeQuickRange: null,
    setSelectedMonitorIds: vi.fn(),
    setSelectedTagIds: vi.fn(),
    setStartDateInput: vi.fn(),
    setEndDateInput: vi.fn(),
    setFavoritesOnly: vi.fn(),
    setActiveQuickRange: vi.fn(),
    applyFilters,
    clearFilters,
    clearDateRange,
    activeFilterCount: 0,
    ...eventFiltersOverrides,
  }),
}));

vi.mock('../../hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
    threshold: 0,
    bind: () => ({}),
  }),
}));

vi.mock('../../components/events/EventCard', () => ({
  EventCard: ({ event, monitorName, profileChip }: { event: { Id: string }; monitorName: string; profileChip?: string }) => (
    <div data-testid="event-card-item">
      {event.Id}-{monitorName}
      {profileChip && <span data-testid="event-card-profile-chip">{profileChip}</span>}
    </div>
  ),
}));

vi.mock('../../components/events/EventHeatmap', () => ({
  EventHeatmap: () => <div data-testid="event-heatmap" />,
}));

vi.mock('../../components/events/EventMontageView', () => ({
  EventMontageView: () => <div data-testid="events-montage-grid" />,
}));

vi.mock('../../components/filters/MonitorFilterPopover', () => ({
  MonitorFilterPopoverContent: () => <div data-testid="monitor-filter" />,
}));

vi.mock('../../components/ui/quick-date-range-buttons', () => ({
  QuickDateRangeButtons: () => <div data-testid="quick-range" />,
}));

vi.mock('../../components/ui/pull-to-refresh-indicator', () => ({
  PullToRefreshIndicator: () => <div data-testid="pull-indicator" />,
}));

vi.mock('../../components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

let mockSearchParams = new URLSearchParams();
const setSearchParamsMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: {} }),
  useSearchParams: () => [mockSearchParams, setSearchParamsMock],
}));

const profileA = { id: 'profile-1', name: 'Home', portalUrl: 'https://a', apiUrl: 'https://a/api', timezone: 'UTC' };
const profileB = { id: 'profile-2', name: 'Office', portalUrl: 'https://b', apiUrl: 'https://b/api', timezone: 'America/New_York' };

function singleScope() {
  mockCurrentProfileId = 'profile-1';
  useProfileScopeMock.mockReturnValue({ mode: 'single', profile: profileA, profiles: [profileA], settings: {} });
}

function allScope(profiles: Array<typeof profileA> = [profileA, profileB]) {
  mockCurrentProfileId = ALL_PROFILES_ID;
  useProfileScopeMock.mockReturnValue({ mode: 'all', profile: null, profiles, settings: {} });
}

function scopedEvents(overrides: Partial<ReturnType<typeof defaultScopedEvents>> = {}) {
  useScopedEventsMock.mockReturnValue({ ...defaultScopedEvents(), ...overrides });
}

function defaultScopedEvents() {
  return {
    events: [] as Array<{ profileId: string; profileName: string; item: { Event: { Id: string; MonitorId: string } } }>,
    errors: [] as Array<{ profileId: string; profileName: string; error: unknown }>,
    isLoading: false,
    isFetching: false,
    totalCount: undefined as number | undefined,
    refetchProfile: vi.fn(),
    refetchAll: vi.fn(async () => {}),
  };
}

describe('Events Page', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'monitors') {
        return { data: { monitors: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'tags') {
        return { data: { tags: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'eventTags') {
        return { data: new Map(), isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });
    useScopedEventsMock.mockReset();
    useScopedMonitorsMock.mockReset();
    useScopedMonitorsMock.mockReturnValue({ monitors: [], errors: [], isLoading: false, refetchProfile: vi.fn() });
    useProfileScopeMock.mockReset();
    singleScope();
    scopedEvents();
    updateProfileSettingsMock.mockClear();
    applyFilters.mockClear();
    clearFilters.mockClear();
    clearDateRange.mockClear();
    setSearchParamsMock.mockClear();
    mockSearchParams = new URLSearchParams();
    eventFiltersOverrides = {};
    settingsOverrides = {};
  });

  it('shows empty state when no events exist', () => {
    render(<Events />);
    expect(screen.getByTestId('events-empty-state')).toBeInTheDocument();
  });

  it('renders event list when events are available', () => {
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '100', MonitorId: '1' } } }],
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'monitors') {
        return {
          data: { monitors: [{ Monitor: { Id: '1', Name: 'Front Door', Deleted: false } }] },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'tags') {
        return { data: { tags: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'eventTags') {
        return { data: new Map(), isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<Events />);

    expect(screen.getByTestId('event-list')).toBeInTheDocument();
    expect(screen.getByTestId('event-card-item')).toHaveTextContent('100-Front Door');
  });

  it('applies and clears filters from the filter panel', async () => {
    render(<Events />);

    expect(screen.getByTestId('events-filter-panel')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-apply-filters'));
    await user.click(screen.getByTestId('events-clear-filters'));

    expect(applyFilters).toHaveBeenCalled();
    expect(clearFilters).toHaveBeenCalled();
  });

  // refs #239: a monitor card's Events button deep-links to
  // ?monitorId=<id>&startDateTime=<watermark>, which hydrates startDateInput while
  // leaving activeQuickRange null (verified against the real hook in
  // hooks/__tests__/useEventFilters.test.ts). The clear-date button must still show
  // up in that case, not only when a quick-range chip set activeQuickRange.
  it('shows the clear-date button for a URL-driven date range with no active quick range', () => {
    eventFiltersOverrides = { startDateInput: '2026-07-10T08:49:38', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    expect(screen.getByTestId('events-clear-quick-range')).toBeInTheDocument();
  });

  it('hides the clear-date button when no date range and no quick range are active', () => {
    eventFiltersOverrides = { startDateInput: '', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    expect(screen.queryByTestId('events-clear-quick-range')).not.toBeInTheDocument();
  });

  it('clicking the clear-date button calls clearDateRange, which preserves monitorId (refs #194)', async () => {
    eventFiltersOverrides = { startDateInput: '2026-07-10T08:49:38', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-clear-quick-range'));

    expect(clearDateRange).toHaveBeenCalled();
    // clearDateRange itself (not this button) is what preserves monitorId; that
    // contract is covered directly in useEventFilters.test.ts's
    // "clearDateRange (refs #194)" describe block.
  });

  it('single mode calls useScopedEvents for its data with no refetchInterval passed (no polling, refs #337)', () => {
    render(<Events />);

    expect(useScopedEventsMock).toHaveBeenCalled();
    const options = useScopedEventsMock.mock.calls.at(-1)?.[0] as { refetchInterval?: number } | undefined;
    expect(options?.refetchInterval).toBeUndefined();
  });

  it('single mode leaves the montage toggle enabled with no gate notice (refs #337 fix round 1)', () => {
    render(<Events />);

    expect(screen.getByTestId('events-view-toggle')).not.toBeDisabled();
    expect(screen.queryByTestId('events-montage-gate')).not.toBeInTheDocument();
  });

  describe('All mode', () => {
    it('renders both profiles\' events with a profile chip per row', () => {
      allScope();
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(2);
      const chips = screen.getAllByTestId('event-card-profile-chip');
      expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
    });

    it('disables the montage toggle with a localized notice (refs #337 fix round 1)', () => {
      allScope();

      render(<Events />);

      expect(screen.getByTestId('events-view-toggle')).toBeDisabled();
      expect(screen.getByTestId('events-montage-gate')).toBeInTheDocument();
      expect(screen.getByTestId('events-montage-gate')).toHaveAttribute('title', 'events.montage_unavailable_all_mode');
    });

    it('the server filter chip row hides a profile\'s slice when toggled off', () => {
      allScope();
      settingsOverrides = { eventsServerFilter: ['profile-1'] };
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('1-');
      expect(screen.getByTestId('events-server-filter-row')).toBeInTheDocument();
    });

    it('shows an error strip for a failed profile with zero events while the healthy profile still renders', () => {
      allScope();
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1' } } }],
        errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('down') }],
      });

      render(<Events />);

      expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
      expect(screen.getByTestId('event-card-item')).toBeInTheDocument();
      expect(screen.queryByTestId('events-all-failed-state')).not.toBeInTheDocument();
    });

    it('a ?profileId= deep link narrows the view without persisting it (refs #337 I9)', () => {
      allScope();
      mockSearchParams = new URLSearchParams('profileId=profile-2');
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('2-');
      // The deep link filters this render only - it must never write the
      // persisted All-mode server filter.
      expect(updateProfileSettingsMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventsServerFilter: expect.anything() })
      );
    });

    it('shows every server again once the ?profileId= param is gone, with no filter left persisted (refs #337 I9)', () => {
      allScope();
      mockSearchParams = new URLSearchParams();
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1' } } },
        ],
      });

      render(<Events />);

      expect(screen.getAllByTestId('event-card-item')).toHaveLength(2);
    });

    it('shows the all-failed empty state when every profile errors', () => {
      allScope();
      scopedEvents({
        events: [],
        errors: [
          { profileId: 'profile-1', profileName: 'Home', error: new Error('down') },
          { profileId: 'profile-2', profileName: 'Office', error: new Error('down') },
        ],
      });

      render(<Events />);

      expect(screen.getByTestId('events-all-failed-state')).toBeInTheDocument();
      expect(screen.getByTestId('events-all-failed-state')).toHaveTextContent('events.all_failed_title');
    });
  });
});
