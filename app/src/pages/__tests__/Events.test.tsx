import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import Events from '../Events';
import { ALL_PROFILES_ID } from '../../api/types';
import { eventInstant } from '../../lib/event/event-instant';
import type { EventData } from '../../api/types';

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: (string | object)[] }) => useQueryMock(options),
  keepPreviousData: (previousData: unknown) => previousData,
}));

const useScopedEventsMock = vi.fn();
const useScopedMonitorsMock = vi.fn();
const useProfileScopeMock = vi.fn();

// The fan-out itself is covered in useScopedEventTags' own suite; stubbed
// here so this page suite keeps its narrow react-query mock. The returned map
// is keyed the way the real hook keys it, so the page's own lookup is still
// under test.
const eventTagMapMock = vi.fn(() => new Map<string, Array<{ Id: string; Name: string }>>());
const availableTagsMock = vi.fn(() => [] as Array<{ Id: string; Name: string }>);
vi.mock('../../hooks/useScopedEventTags', () => ({
  useScopedTags: () => ({
    availableTags: availableTagsMock(),
    tagsSupported: true,
    isLoadingTags: false,
    resolveOwnTagIds: (t: string[]) => t,
  }),
  useScopedEventTagMapping: () => ({ eventTagMap: eventTagMapMock(), getTagsForEvent: () => [] }),
}));
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
let favoritesOnlyOverride = false;
let eventFiltersOverrides: {
  startDateInput?: string;
  endDateInput?: string;
  activeQuickRange?: number | null;
  selectedTagIds?: string[];
} = {};

vi.mock('../../hooks/useEventFilters', () => ({
  ALL_TAGS_FILTER_ID: '__all_tags__',
  useEventFilters: () => ({
    filters: {},
    selectedMonitorIds: [],
    selectedTagIds: [],
    startDateInput: '',
    endDateInput: '',
    favoritesOnly: favoritesOnlyOverride,
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
  EventCard: ({ event, monitorName, profileChip, tags }: { event: { Id: string }; monitorName: string; profileChip?: string; tags?: Array<{ Name: string }> }) => (
    <div data-testid="event-card-item">
      {event.Id}-{monitorName}
      {profileChip && <span data-testid="event-card-profile-chip">{profileChip}</span>}
      {tags?.map((t) => <span key={t.Name} data-testid="event-card-tag">{t.Name}</span>)}
    </div>
  ),
}));

vi.mock('../../components/events/EventHeatmap', () => ({
  EventHeatmap: ({ startDate, endDate }: { startDate?: Date; endDate?: Date }) => (
    <div
      data-testid="event-heatmap"
      data-start={startDate?.getTime() ?? ''}
      data-end={endDate?.getTime() ?? ''}
    />
  ),
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
    events: [] as Array<{ profileId: string; profileName: string; item: { Event: { Id: string; MonitorId: string; StartDateTime?: string } } }>,
    errors: [] as Array<{ profileId: string; profileName: string; error: unknown }>,
    isLoading: false,
    isFetching: false,
    totalCount: undefined as number | undefined,
    totalCountByProfile: {} as Record<string, number>,
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
    eventTagMapMock.mockReset();
    eventTagMapMock.mockReturnValue(new Map());
    availableTagsMock.mockReset();
    availableTagsMock.mockReturnValue([]);
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
    favoritesOnlyOverride = false;
    settingsOverrides = {};
  });

  it('shows empty state when no events exist', () => {
    render(<Events />);
    expect(screen.getByTestId('events-empty-state')).toHaveTextContent('events.no_events');
  });

  it('renders event list when events are available', () => {
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '100', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
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

    expect(screen.getByTestId('event-list')).toHaveTextContent('100-Front Door');
    expect(screen.getByTestId('event-card-item')).toHaveTextContent('100-Front Door');
  });

  it('applies and clears filters from the filter panel', async () => {
    render(<Events />);

    expect(screen.getByTestId('events-filter-panel')).toHaveTextContent('common.filter');
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

    expect(screen.getByTestId('events-clear-quick-range')).toHaveAttribute('title', 'common.clear');
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

  // "All tags" expands to every available tag id. When that list is empty -
  // cold load, a failed /tags request, a server without tag support - the
  // expansion produces [], which is a truthy filter meaning "matches nothing",
  // so the list would go silently empty with no banner explaining why. Single
  // mode too, not just All mode.
  it('sends no tag filter when "All tags" is selected but no tags have loaded', () => {
    eventFiltersOverrides = { selectedTagIds: ['__all_tags__'] };
    availableTagsMock.mockReturnValue([]);

    render(<Events />);

    const options = useScopedEventsMock.mock.calls.at(-1)?.[0] as { tagIdsByProfile?: unknown };
    expect(options?.tagIdsByProfile).toBeUndefined();
  });

  it('expands "All tags" to every loaded tag id when there are some', () => {
    eventFiltersOverrides = { selectedTagIds: ['__all_tags__'] };
    availableTagsMock.mockReturnValue([{ Id: '1', Name: 'person' }, { Id: '2', Name: 'cat' }]);

    render(<Events />);

    const options = useScopedEventsMock.mock.calls.at(-1)?.[0] as { tagIdsByProfile?: Record<string, string[]> };
    expect(options?.tagIdsByProfile).toEqual({ 'profile-1': ['1', '2'] });
  });

  it('single mode leaves the montage toggle enabled with no gate notice (refs #337 fix round 1)', () => {
    render(<Events />);

    expect(screen.getByTestId('events-view-toggle')).not.toBeDisabled();
    expect(screen.queryByTestId('events-montage-gate')).not.toBeInTheDocument();
  });

  // refs #337 round 2: the I9 fix dropped the persisted write for the
  // ?view=montage deep link but left the settings-sync effect (which also
  // fires on mount) free to immediately overwrite the deep link's
  // setViewMode('montage') with the persisted (list) preference - a
  // same-mount race that silently broke the deep link.
  it('a ?view=montage deep link renders montage without a persisted write, surviving the settings-sync effect on the same mount (refs #337 round 2)', () => {
    mockSearchParams = new URLSearchParams('view=montage');
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);

    // EventMontageView is mocked to a bare decorative div (no text/attrs); its
    // presence vs. the list view's is the only observable signal, so pair it
    // with the list view's absence to pin down which branch actually rendered.
    expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();
    expect(updateProfileSettingsMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventsViewMode: expect.anything() })
    );
  });

  // viewMode is derived from the ?view param and the persisted preference, so
  // switching back to list is entirely the two writes below: nothing else
  // clears the param, and leaving it set would pin the page in montage while
  // the toggle claims to have switched.
  it('switching back to list both persists list and clears the ?view param', () => {
    settingsOverrides = { eventsViewMode: 'montage' };
    mockSearchParams = new URLSearchParams('view=montage&monitorId=4');
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);
    // Precondition: the page really is in montage, so the click below means
    // "switch to list" rather than "switch to montage". EventMontageView is a
    // bare decorative mock, so pair its presence with the list view's absence.
    expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('events-view-toggle'));

    expect(updateProfileSettingsMock).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ eventsViewMode: 'list' })
    );
    const nextParams = setSearchParamsMock.mock.calls.at(-1)?.[0] as URLSearchParams;
    expect(nextParams.get('view')).toBeNull();
    // The other filters ride along in the same object and must survive.
    expect(nextParams.get('monitorId')).toBe('4');
  });

  it('settings-sync still applies the persisted view when no ?view param is present (refs #337 round 2)', () => {
    settingsOverrides = { eventsViewMode: 'montage' };
    scopedEvents({
      events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
    });

    render(<Events />);

    // EventMontageView is mocked to a bare decorative div (no text/attrs);
    // pair its presence with the list view's absence to confirm the
    // persisted setting actually won the branch, not just that something rendered.
    expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();
  });

  describe('All mode', () => {
    it('renders both profiles\' events with a profile chip per row', () => {
      allScope();
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(2);
      const chips = screen.getAllByTestId('event-card-profile-chip');
      expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
    });

    it('tags a colliding event id from the server that owns it (refs #337 D4)', () => {
      allScope();
      // Both servers have an event 1. Before the fan-out, tags in All mode
      // were fetched from the current profile only (there is none) and looked
      // up by bare event id, so one server's tags could land on the other
      // server's row.
      eventTagMapMock.mockReturnValue(
        new Map([
          ['profile-1:1', [{ Id: '4', Name: 'person' }]],
          ['profile-2:1', [{ Id: '9', Name: 'vehicle' }]],
        ])
      );
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 09:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards[0]).toHaveTextContent('person');
      expect(cards[0]).not.toHaveTextContent('vehicle');
      expect(cards[1]).toHaveTextContent('vehicle');
      expect(cards[1]).not.toHaveTextContent('person');
    });

    // ZoneMinder cannot combine its Tags.Id: filter with the favorites Id IN:
    // query, so that one combination falls to a client-side pass. In All mode
    // the selection is tag NAMES (ids differ per server), and matching them
    // against tag.Id there drops every row.
    it('matches the favorites+tags client pass by tag name in All mode (refs #337 D4)', () => {
      allScope();
      eventFiltersOverrides = { selectedTagIds: ['person'] };
      favoritesOnlyOverride = true;
      eventTagMapMock.mockReturnValue(
        new Map([
          ['profile-1:1', [{ Id: '4', Name: 'person' }]],
          ['profile-2:2', [{ Id: '9', Name: 'vehicle' }]],
        ])
      );
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 09:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('person');
    });

    // heatmapDateRange (the OTHER consumer of event timestamps besides the
    // buckets fixed earlier) must derive its start/end from the same real
    // instants (eventInstant) the buckets use - a naively-derived window can
    // fall short of an instant the buckets would otherwise place inside it,
    // silently dropping that event from the heatmap (refs #337). Goes
    // through the real heatmapDateRange computation (no explicit
    // start/endDateTime filter), not explicit start/end props passed
    // straight to EventHeatmap - that's what the earlier per-widget
    // timezone tests couldn't catch.
    it('heatmapDateRange spans both events\' real instants across two profile timezones', () => {
      allScope();
      const startDateTime = '2026-06-15 06:00:00';
      scopedEvents({
        events: [
          { profileId: profileA.id, profileName: profileA.name, item: { Event: { Id: '1', MonitorId: '1', StartDateTime: startDateTime } } },
          { profileId: profileB.id, profileName: profileB.name, item: { Event: { Id: '2', MonitorId: '1', StartDateTime: startDateTime } } },
        ] as never,
      });

      render(<Events />);

      const heatmap = screen.getByTestId('event-heatmap');
      const rangeStart = Number(heatmap.getAttribute('data-start'));
      const rangeEnd = Number(heatmap.getAttribute('data-end'));

      const instantA = eventInstant({ Event: { StartDateTime: startDateTime } } as EventData, profileA.timezone);
      const instantB = eventInstant({ Event: { StartDateTime: startDateTime } } as EventData, profileB.timezone);
      // America/New_York is 4h behind UTC in June: the two real instants
      // are genuinely 4h apart, not the same millisecond a naive parse of
      // the identical wall-clock string would have produced.
      expect(instantB - instantA).toBe(4 * 60 * 60 * 1000);

      expect(rangeStart).toBeLessThanOrEqual(instantA);
      expect(rangeEnd).toBeGreaterThanOrEqual(instantA);
      expect(rangeStart).toBeLessThanOrEqual(instantB);
      expect(rangeEnd).toBeGreaterThanOrEqual(instantB);
    });

    it('leaves the montage toggle enabled with no gate notice, and renders montage (refs #337 Task 2 fix round 3)', () => {
      allScope();
      mockSearchParams = new URLSearchParams('view=montage');
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
      });

      render(<Events />);

      expect(screen.getByTestId('events-view-toggle')).not.toBeDisabled();
      expect(screen.queryByTestId('events-montage-gate')).not.toBeInTheDocument();
      // EventMontageView is mocked to a bare decorative div (no text/attrs);
      // pair its presence with the list view's absence.
      expect(screen.getByTestId('events-montage-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('event-list')).not.toBeInTheDocument();
    });

    it('the server filter chip row hides a profile\'s slice when toggled off', () => {
      allScope();
      settingsOverrides = { eventsServerFilter: ['profile-1'] };
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('1-');
      expect(screen.getByTestId('events-server-filter-profile-1')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('events-server-filter-profile-2')).toHaveAttribute('aria-pressed', 'false');
    });

    it('drops a deleted profile\'s id from the persisted server filter instead of silently hiding everything (refs #337)', () => {
      allScope();
      settingsOverrides = { eventsServerFilter: ['deleted-profile-id'] };
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      // The persisted filter named only a profile that no longer exists - that
      // must reconcile to "no filter", not silently hide every real profile.
      expect(screen.getAllByTestId('event-card-item')).toHaveLength(2);
    });

    it('keeps a persisted filter\'s live ids while dropping only the deleted one', () => {
      allScope();
      settingsOverrides = { eventsServerFilter: ['profile-1', 'deleted-profile-id'] };
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
        ],
      });

      render(<Events />);

      const cards = screen.getAllByTestId('event-card-item');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('1-');
    });

    it('"Showing X of Y" reflects only the server-filtered profiles, not every profile in scope (refs #337)', () => {
      allScope();
      settingsOverrides = { eventsServerFilter: ['profile-1'] };
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
        totalCount: 5,
        totalCountByProfile: { 'profile-1': 1, 'profile-2': 4 },
      });

      render(<Events />);

      expect(screen.getByText('events.showing_of_total:{"showing":1,"total":1}')).toHaveTextContent(
        'events.showing_of_total:{"showing":1,"total":1}'
      );
    });

    it('shows a localized hint instead of the plain empty state when the server filter hides every profile (refs #337)', () => {
      allScope();
      settingsOverrides = { eventsServerFilter: [] };
      scopedEvents({ events: [] });

      render(<Events />);

      expect(screen.getByTestId('events-filter-empty-hint')).toHaveTextContent('events.filter_hides_everything');
      expect(screen.queryByTestId('events-empty-state')).not.toBeInTheDocument();
    });

    it('shows an error strip for a failed profile with zero events while the healthy profile still renders', () => {
      allScope();
      scopedEvents({
        events: [{ profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } }],
        errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('down') }],
      });

      render(<Events />);

      expect(screen.getByTestId('profile-error-strip-profile-2')).toHaveTextContent('Office:');
      expect(screen.getByTestId('event-card-item')).toHaveTextContent('1-Camera 1');
      expect(screen.queryByTestId('events-all-failed-state')).not.toBeInTheDocument();
    });

    it('a ?profileId= deep link narrows the view without persisting it (refs #337 I9)', () => {
      allScope();
      mockSearchParams = new URLSearchParams('profileId=profile-2');
      scopedEvents({
        events: [
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
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
          { profileId: 'profile-1', profileName: 'Home', item: { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
          { profileId: 'profile-2', profileName: 'Office', item: { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-08-03 10:00:00' } } },
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

      // Confirms the branch that rendered is genuinely the all-failed state,
      // not merely that some empty-state div exists.
      expect(screen.queryByTestId('events-empty-state')).toBeNull();
      expect(screen.getByTestId('events-all-failed-state')).toHaveTextContent('events.all_failed_title');
    });
  });
});
