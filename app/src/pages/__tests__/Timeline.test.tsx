import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Timeline from '../Timeline';

const useTimelineDataMock = vi.fn();
const useScopedTimelineEventsMock = vi.fn();
const useProfileScopeMock = vi.fn();

vi.mock('../../hooks/useTimelineData', () => ({
  useTimelineData: (opts: unknown) => useTimelineDataMock(opts),
}));
vi.mock('../../hooks/useScopedTimelineEvents', () => ({
  useScopedTimelineEvents: (opts: unknown) => useScopedTimelineEventsMock(opts),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: () => useProfileScopeMock(),
}));

vi.mock('../../hooks/useTimelineFilters', () => ({
  useTimelineFilters: () => ({
    selectedMonitorIds: [],
    startDateInput: '',
    endDateInput: '',
    onlyDetectedObjects: false,
    causeFilter: '',
    activeQuickRange: null,
    setSelectedMonitorIds: vi.fn(),
    setStartDateInput: vi.fn(),
    setEndDateInput: vi.fn(),
    setOnlyDetectedObjects: vi.fn(),
    setCauseFilter: vi.fn(),
    setActiveQuickRange: vi.fn(),
    clearFilters: vi.fn(),
    activeFilterCount: 0,
  }),
}));

vi.mock('../../hooks/useTvKeyHandler', () => ({ useTvKeyHandler: () => {} }));
vi.mock('../../hooks/useEventTags', () => ({
  useEventTagMapping: () => ({ getTagsForEvent: () => [] }),
}));

vi.mock('../../components/timeline/TimelineCanvas', () => ({
  TimelineCanvas: ({ monitors, events }: { monitors: Array<{ id: string; name: string; profileChip?: string }>; events: unknown[] }) => (
    <div data-testid="timeline-canvas-stub">
      <span data-testid="timeline-canvas-event-count">{events.length}</span>
      {monitors.map((m) => (
        <div key={m.id} data-testid={`timeline-monitor-row-${m.id}`}>
          {m.name}
          {m.profileChip && <span data-testid="timeline-row-profile-chip">{m.profileChip}</span>}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('../../components/timeline/TimelineFiltersPanel', () => ({
  TimelineFiltersPanel: () => <div data-testid="timeline-filters-panel-stub" />,
}));
vi.mock('../../components/timeline/TimelineToolbar', () => ({
  TimelineToolbar: () => <div data-testid="timeline-toolbar-stub" />,
}));
vi.mock('../../components/timeline/TimelineStats', () => ({
  TimelineStats: () => <div data-testid="timeline-stats-stub" />,
}));
vi.mock('../../components/timeline/DetectionFilterTabs', () => ({
  DetectionFilterTabs: () => <div data-testid="detection-filter-tabs-stub" />,
  categorizeEvent: () => 'all',
}));
vi.mock('../../components/timeline/EventPreviewPopover', () => ({
  EventPreviewPopover: () => <div data-testid="event-preview-popover-stub" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ key: 'k', state: {} }),
}));

function defaultSingle() {
  return {
    data: { events: [] },
    isLoading: false,
    error: null,
    enabledMonitors: [],
    allTimelineEvents: [],
    eventIds: [],
    rawEventMap: new Map(),
  };
}

function defaultScoped() {
  return {
    isLoading: false,
    errors: [],
    enabledMonitors: [],
    events: [],
    rawEvents: [],
    eventIds: [],
    refetchProfile: vi.fn(),
  };
}

describe('Timeline Page', () => {
  beforeEach(() => {
    useTimelineDataMock.mockReset();
    useScopedTimelineEventsMock.mockReset();
    useProfileScopeMock.mockReset();
    useTimelineDataMock.mockReturnValue(defaultSingle());
    useScopedTimelineEventsMock.mockReturnValue(defaultScoped());
  });

  it('single mode renders via useTimelineData with no aggregation', () => {
    useProfileScopeMock.mockReturnValue({ mode: 'single', profile: { id: 'profile-1' }, profiles: [{ id: 'profile-1' }], settings: {} });
    useTimelineDataMock.mockReturnValue({
      ...defaultSingle(),
      enabledMonitors: [{ Monitor: { Id: '1', Name: 'Front Door' } }],
      allTimelineEvents: [{ id: 'e1', monitorId: '1', startMs: 1000, endMs: 2000, cause: 'Motion', alarmRatio: 0.5, notes: '' }],
    });

    render(<Timeline />);

    expect(screen.getByTestId('timeline-canvas-event-count')).toHaveTextContent('1');
    expect(screen.getByTestId('timeline-monitor-row-1')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('timeline-row-profile-chip')).not.toBeInTheDocument();
  });

  it('All mode aggregates both profiles\' bands via useScopedTimelineEvents, each chip\'d with its owning profile', () => {
    useProfileScopeMock.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [
        { id: 'profile-1', name: 'Home', timezone: 'UTC' },
        { id: 'profile-2', name: 'Office', timezone: 'America/New_York' },
      ],
      settings: {},
    });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam' } } },
      ],
      events: [
        { id: 'a1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
        { id: 'b1', monitorId: '2', startMs: 4000, endMs: 4500, cause: 'Motion', alarmRatio: 0.9, notes: '', profileId: 'profile-2', profileChip: 'Office' },
      ],
    });

    render(<Timeline />);

    expect(screen.getByTestId('timeline-canvas-event-count')).toHaveTextContent('2');
    expect(screen.getByTestId('timeline-monitor-row-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('timeline-monitor-row-2')).toHaveTextContent('Lobby Cam');
    const chips = screen.getAllByTestId('timeline-row-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
  });

  it('All mode shows a retry-able error strip for a failed profile while the healthy one still renders bands', () => {
    useProfileScopeMock.mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [
        { id: 'profile-1', name: 'Home', timezone: 'UTC' },
        { id: 'profile-2', name: 'Office', timezone: 'America/New_York' },
      ],
      settings: {},
    });
    useScopedTimelineEventsMock.mockReturnValue({
      ...defaultScoped(),
      enabledMonitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
      ],
      events: [
        { id: 'a1', monitorId: '1', startMs: 5000, endMs: 6000, cause: 'Motion', alarmRatio: 0.2, notes: '', profileId: 'profile-1', profileChip: 'Home' },
      ],
      errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('down') }],
    });

    render(<Timeline />);

    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-canvas-event-count')).toHaveTextContent('1');
  });
});
