import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import Events from '../Events';

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: (string | object)[] }) => useQueryMock(options),
  keepPreviousData: (previousData: unknown) => previousData,
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfile: () => { id: string; portalUrl: string; apiUrl: string } }) => unknown) =>
    selector({
      currentProfile: () => ({ id: 'profile-1', portalUrl: 'https://portal.test', apiUrl: 'https://api.test' }),
    }),
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
}));

vi.mock('../../stores/settings', () => ({
  ALL_GROUPS_KEY: '__all__',
  DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT: { gridCols: 3 },
  DEFAULT_SETTINGS: {
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'light',
    defaultEventLimit: 50,
    eventsViewMode: 'list',
    eventMontageByGroup: { '__all__': { gridCols: 3 } },
    excludedMonitorIds: [],
  },
  useSettingsStore: (selector: (state: { getProfileSettings: (id: string) => { defaultEventLimit: number; eventsViewMode: 'list'; eventMontageByGroup: Record<string, { gridCols: number }> }; updateProfileSettings: () => void; updateEventMontageGroupLayout: () => void }) => unknown) =>
    selector({
      getProfileSettings: () => ({ defaultEventLimit: 50, eventsViewMode: 'list', eventMontageByGroup: { '__all__': { gridCols: 3 } }, excludedMonitorIds: [] }),
      updateProfileSettings: vi.fn(),
      updateEventMontageGroupLayout: vi.fn(),
    }),
}));

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
    containerRef: { current: null },
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
    threshold: 0,
    bind: () => ({}),
  }),
}));

vi.mock('../../components/events/EventCard', () => ({
  EventCard: ({ event, monitorName }: { event: { Id: string }; monitorName: string }) => (
    <div data-testid="event-card-item">
      {event.Id}-{monitorName}
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

vi.mock('../../api/events', () => ({
  getEvents: vi.fn(),
  getEventImageUrl: vi.fn(() => 'https://example.test/thumb.jpg'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: {} }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

describe('Events Page', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    applyFilters.mockClear();
    clearFilters.mockClear();
    clearDateRange.mockClear();
    eventFiltersOverrides = {};
  });

  it('shows empty state when no events exist', () => {
    useQueryMock.mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'monitors') {
        return { data: { monitors: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'events') {
        return { data: { events: [] }, isLoading: false, error: null, refetch: vi.fn() };
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

    expect(screen.getByTestId('events-empty-state')).toBeInTheDocument();
  });

  it('renders event list when events are available', () => {
    useQueryMock.mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'monitors') {
        return {
          data: {
            monitors: [
              { Monitor: { Id: '1', Name: 'Front Door', Deleted: false } },
            ],
          },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'events') {
        return {
          data: {
            events: [
              {
                Event: {
                  Id: '100',
                  MonitorId: '1',
                },
              },
            ],
          },
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
    useQueryMock.mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'monitors') {
        return { data: { monitors: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey[0] === 'events') {
        return { data: { events: [] }, isLoading: false, error: null, refetch: vi.fn() };
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
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'events') {
        return { data: { events: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });
    eventFiltersOverrides = { startDateInput: '2026-07-10T08:49:38', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    expect(screen.getByTestId('events-clear-quick-range')).toBeInTheDocument();
  });

  it('hides the clear-date button when no date range and no quick range are active', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'events') {
        return { data: { events: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });
    eventFiltersOverrides = { startDateInput: '', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    expect(screen.queryByTestId('events-clear-quick-range')).not.toBeInTheDocument();
  });

  it('clicking the clear-date button calls clearDateRange, which preserves monitorId (refs #194)', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: (string | object)[] }) => {
      if (queryKey[0] === 'events') {
        return { data: { events: [] }, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });
    eventFiltersOverrides = { startDateInput: '2026-07-10T08:49:38', endDateInput: '', activeQuickRange: null };

    render(<Events />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-clear-quick-range'));

    expect(clearDateRange).toHaveBeenCalled();
    // clearDateRange itself (not this button) is what preserves monitorId; that
    // contract is covered directly in useEventFilters.test.ts's
    // "clearDateRange (refs #194)" describe block.
  });
});
