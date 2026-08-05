/**
 * useEventFilters Hook Tests
 *
 * Tests filter state management, URL sync, and settings persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventFilters, ALL_TAGS_FILTER_ID } from '../useEventFilters';
import { resolveOwnMonitorIds } from '../useScopedEvents';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

// Mock react-router-dom
const mockSearchParams = new URLSearchParams();
const mockSetSearchParams = vi.fn();
const mockLocation = { state: null, pathname: '/events', search: '', hash: '', key: 'default' };

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  useLocation: () => mockLocation,
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    time: vi.fn(),
  },
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

// Mock useCurrentProfile
const mockCurrentProfile = { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 };
const mockGetProfileSettings = vi.fn();
const mockUpdateProfileSettings = vi.fn();

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
}));

// Mock settings store
vi.mock('../../stores/settings', () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

// Mock the profile store: the hook persists against currentProfileId, which is
// the ALL sentinel in All mode and a real id in single mode.
let mockCurrentProfileId: string | null = 'profile-1';
vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string | null }) => unknown) =>
    selector({ currentProfileId: mockCurrentProfileId }),
}));

import { useCurrentProfile } from '../useCurrentProfile';
import { useSettingsStore } from '../../stores/settings';

const defaultEventsPageFilters = {
  monitorIds: [] as string[],
  tagIds: [] as string[],
  startDateTime: '',
  endDateTime: '',
  favoritesOnly: false,
  onlyDetectedObjects: false,
};

const mockProfileSettings = {
  defaultEventLimit: 100,
  eventsPageFilters: { ...defaultEventsPageFilters },
};

function setupMocks(overrides?: Partial<typeof mockProfileSettings>) {
  const settings = { ...mockProfileSettings, ...overrides };
  mockCurrentProfileId = 'profile-1';

  vi.mocked(useCurrentProfile).mockReturnValue({
    currentProfile: mockCurrentProfile,
    settings: settings as never,
    hasProfile: true,
    isAllMode: false,
  });

  mockGetProfileSettings.mockReturnValue(settings);
  mockUpdateProfileSettings.mockImplementation(() => {});

  vi.mocked(useSettingsStore.getState).mockReturnValue({
    getProfileSettings: mockGetProfileSettings,
    updateProfileSettings: mockUpdateProfileSettings,
  } as never);
}

/** Captures the hook's value on every render, so first-render state is observable. */
function renderCapturingFilters() {
  const monitorIdPerRender: (string | undefined)[] = [];
  const view = renderHook(() => {
    const r = useEventFilters();
    monitorIdPerRender.push(r.filters.monitorId);
    return r;
  });
  return { ...view, monitorIdPerRender };
}

describe('useEventFilters first-render hydration (refs #197)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Collect keys before deleting: forEach walks by live index, so deleting
    // during iteration skips every other key once 2+ are set.
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupMocks();
  });

  // The Events page builds its React Query key from filters.monitorId on the
  // first render. If the persisted filter only lands in a post-paint effect,
  // that first render fetches the unfiltered list, and useScrollRestoration
  // (a layout effect) restores against it before the filter narrows the list.
  it('applies the persisted monitor filter on the very first render', () => {
    setupMocks({ eventsPageFilters: { ...defaultEventsPageFilters, monitorIds: ['3'] } });

    const { monitorIdPerRender, result } = renderCapturingFilters();

    expect(monitorIdPerRender[0]).toBe('3');
    expect(result.current.filters.monitorId).toBe('3');
  });

  it('lets a deep-link URL filter win over the persisted one, also on the first render', () => {
    mockSearchParams.set('monitorId', '7');
    setupMocks({ eventsPageFilters: { ...defaultEventsPageFilters, monitorIds: ['3'] } });

    const { monitorIdPerRender, result } = renderCapturingFilters();

    expect(monitorIdPerRender[0]).toBe('7');
    expect(result.current.filters.monitorId).toBe('7');
  });

  it('renders no monitor filter when neither settings nor URL carry one', () => {
    const { monitorIdPerRender } = renderCapturingFilters();
    expect(monitorIdPerRender[0]).toBeUndefined();
  });

  // A monitor card's Events button deep-links to ?monitorId=<id>&startDateTime=<watermark>
  // (refs #239). That URL sets startDateInput but leaves activeQuickRange null, since
  // resolveInitialFilters only ever sets activeQuickRange from the persisted settings
  // path, never from the URL. The Events page's clear-date button must key off
  // startDateInput/endDateInput too, not just activeQuickRange, or this state is
  // unclearable without also losing the monitor filter.
  it('hydrates startDateInput from a deep-linked date but leaves activeQuickRange null', () => {
    mockSearchParams.set('monitorId', '1');
    mockSearchParams.set('startDateTime', '2026-07-10T08:49:38');
    setupMocks();

    const { result } = renderCapturingFilters();

    expect(result.current.startDateInput).not.toBe('');
    expect(result.current.activeQuickRange).toBeNull();
  });
});

describe('useEventFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset search params. Collect keys first: forEach walks by live index, so
    // deleting during iteration skips every other key once 2+ are set.
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupMocks();
  });

  describe('initial state', () => {
    it('returns empty filter values on first render', () => {
      const { result } = renderHook(() => useEventFilters());

      expect(result.current.selectedMonitorIds).toEqual([]);
      expect(result.current.selectedTagIds).toEqual([]);
      expect(result.current.startDateInput).toBe('');
      expect(result.current.endDateInput).toBe('');
      expect(result.current.favoritesOnly).toBe(false);
      expect(result.current.onlyDetectedObjects).toBe(false);
    });

    it('computes activeFilterCount as 0 when no filters set', () => {
      const { result } = renderHook(() => useEventFilters());
      expect(result.current.activeFilterCount).toBe(0);
    });

    it('returns default filters object with correct shape', () => {
      const { result } = renderHook(() => useEventFilters());

      expect(result.current.filters).toMatchObject({
        limit: 100,
        sort: 'StartDateTime',
        direction: 'desc',
      });
      expect(result.current.filters.monitorId).toBeUndefined();
      expect(result.current.filters.startDateTime).toBeUndefined();
      expect(result.current.filters.endDateTime).toBeUndefined();
    });

    it('exports ALL_TAGS_FILTER_ID sentinel constant', () => {
      expect(ALL_TAGS_FILTER_ID).toBe('__all_tags__');
    });
  });

  describe('setSelectedMonitorIds', () => {
    it('updates selectedMonitorIds state', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1', '2']);
      });

      expect(result.current.selectedMonitorIds).toEqual(['1', '2']);
    });

    it('reflects monitor selection in derived filters.monitorId', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['3', '4']);
      });

      expect(result.current.filters.monitorId).toBe('3,4');
    });

    it('sets filters.monitorId to undefined when list is empty', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1']);
      });
      act(() => {
        result.current.setSelectedMonitorIds([]);
      });

      expect(result.current.filters.monitorId).toBeUndefined();
    });

    it('persists to settings store when profile is present', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['5']);
      });

      expect(mockUpdateProfileSettings).toHaveBeenCalledWith(
        'profile-1',
        expect.objectContaining({
          eventsPageFilters: expect.objectContaining({ monitorIds: ['5'] }),
        }),
      );
    });
  });

  describe('setSelectedTagIds', () => {
    it('updates selectedTagIds state', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedTagIds(['tag-a', 'tag-b']);
      });

      expect(result.current.selectedTagIds).toEqual(['tag-a', 'tag-b']);
    });

    it('increments activeFilterCount for tag selection', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedTagIds(['tag-a']);
      });

      expect(result.current.activeFilterCount).toBe(1);
    });
  });

  describe('date range filters', () => {
    it('sets start date input', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('2024-01-01T00:00');
      });

      expect(result.current.startDateInput).toBe('2024-01-01T00:00');
      expect(result.current.filters.startDateTime).toBe('2024-01-01T00:00');
    });

    it('sets end date input', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setEndDateInput('2024-12-31T23:59');
      });

      expect(result.current.endDateInput).toBe('2024-12-31T23:59');
      expect(result.current.filters.endDateTime).toBe('2024-12-31T23:59');
    });

    it('leaves startDateTime undefined in filters when empty', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('');
      });

      expect(result.current.filters.startDateTime).toBeUndefined();
    });

    it('counts each date field separately in activeFilterCount', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-12-31T23:59');
      });

      expect(result.current.activeFilterCount).toBe(2);
    });
  });

  describe('favoritesOnly filter', () => {
    it('toggles favoritesOnly on', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setFavoritesOnly(true);
      });

      expect(result.current.favoritesOnly).toBe(true);
      expect(result.current.activeFilterCount).toBe(1);
    });

    it('toggles favoritesOnly off', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setFavoritesOnly(true);
      });
      act(() => {
        result.current.setFavoritesOnly(false);
      });

      expect(result.current.favoritesOnly).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });
  });

  describe('archivedOnly filter', () => {
    it('toggles archivedOnly on', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });

      expect(result.current.archivedOnly).toBe(true);
      expect(result.current.activeFilterCount).toBe(1);
    });

    it('toggles archivedOnly off', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });
      act(() => {
        result.current.setArchivedOnly(false);
      });

      expect(result.current.archivedOnly).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });

    it('reflects archivedOnly in the archived URL param', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });
      act(() => {
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('archived')).toBe('true');
    });

    it('sets filters.archived to true when archivedOnly is enabled', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setArchivedOnly(true);
      });

      expect(result.current.filters.archived).toBe(true);
    });
  });

  describe('onlyDetectedObjects filter', () => {
    it('enables onlyDetectedObjects and sets notesRegexp', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setOnlyDetectedObjects(true);
      });

      expect(result.current.onlyDetectedObjects).toBe(true);
      expect(result.current.filters.notesRegexp).toBe('detected:');
    });

    it('disables onlyDetectedObjects and clears notesRegexp', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setOnlyDetectedObjects(true);
      });
      act(() => {
        result.current.setOnlyDetectedObjects(false);
      });

      expect(result.current.filters.notesRegexp).toBeUndefined();
    });
  });

  describe('toggleMonitorSelection', () => {
    it('adds a monitor ID that is not yet selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.toggleMonitorSelection('7');
      });

      expect(result.current.selectedMonitorIds).toContain('7');
    });

    it('removes a monitor ID that is already selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['7', '8']);
      });
      act(() => {
        result.current.toggleMonitorSelection('7');
      });

      expect(result.current.selectedMonitorIds).not.toContain('7');
      expect(result.current.selectedMonitorIds).toContain('8');
    });
  });

  describe('toggleTagSelection', () => {
    it('adds a tag ID not yet selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.toggleTagSelection('tag-x');
      });

      expect(result.current.selectedTagIds).toContain('tag-x');
    });

    it('removes a tag ID already selected', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedTagIds(['tag-x', 'tag-y']);
      });
      act(() => {
        result.current.toggleTagSelection('tag-x');
      });

      expect(result.current.selectedTagIds).not.toContain('tag-x');
      expect(result.current.selectedTagIds).toContain('tag-y');
    });
  });

  describe('clearFilters', () => {
    it('resets all filter state to empty', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1', '2']);
        result.current.setSelectedTagIds(['tag-a']);
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-12-31T23:59');
        result.current.setFavoritesOnly(true);
        result.current.setOnlyDetectedObjects(true);
      });

      act(() => {
        result.current.clearFilters();
      });

      expect(result.current.selectedMonitorIds).toEqual([]);
      expect(result.current.selectedTagIds).toEqual([]);
      expect(result.current.startDateInput).toBe('');
      expect(result.current.endDateInput).toBe('');
      expect(result.current.favoritesOnly).toBe(false);
      expect(result.current.onlyDetectedObjects).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });

    it('calls setSearchParams on clear to remove URL params', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.clearFilters();
      });

      expect(mockSetSearchParams).toHaveBeenCalled();
    });
  });

  describe('applyFilters', () => {
    it('calls setSearchParams with current filter state', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['3']);
      });
      act(() => {
        result.current.applyFilters();
      });

      expect(mockSetSearchParams).toHaveBeenCalled();
      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('monitorId')).toBe('3');
    });

    it('sets default sort and direction params if absent', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('sort')).toBe('StartDateTime');
      expect(newParams.get('direction')).toBe('desc');
    });

    it('removes monitorId from URL when monitor list is cleared', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds([]);
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('monitorId')).toBeNull();
    });
  });

  describe('applyFilters with date overrides (refs #193)', () => {
    it('writes override dates to URL instead of current state values', () => {
      const { result } = renderHook(() => useEventFilters());

      // Simulate the stale state: a previously selected range is in state...
      act(() => {
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-01-02T00:00');
      });

      // ...but the quick-range handler passes the freshly computed range as overrides.
      act(() => {
        result.current.applyFilters({
          startDateTime: '2024-06-01T06:00',
          endDateTime: '2024-06-01T10:00',
        });
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('startDateTime')).toBe('2024-06-01T06:00');
      expect(newParams.get('endDateTime')).toBe('2024-06-01T10:00');
    });

    it('falls back to current date state when no overrides are passed', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setStartDateInput('2024-03-03T03:00');
        result.current.setEndDateInput('2024-03-04T04:00');
      });
      act(() => {
        result.current.applyFilters();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('startDateTime')).toBe('2024-03-03T03:00');
      expect(newParams.get('endDateTime')).toBe('2024-03-04T04:00');
    });
  });

  describe('clearDateRange (refs #194)', () => {
    it('clears the date range and active quick range but keeps monitor selection', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['5']);
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-01-02T00:00');
        result.current.setActiveQuickRange(4);
      });

      act(() => {
        result.current.clearDateRange();
      });

      expect(result.current.startDateInput).toBe('');
      expect(result.current.endDateInput).toBe('');
      expect(result.current.activeQuickRange).toBeNull();
      // Monitor scope must survive clearing the time filter.
      expect(result.current.selectedMonitorIds).toEqual(['5']);
    });

    it('removes only the date params from the URL, preserving monitorId', () => {
      mockSearchParams.set('monitorId', '5');
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.clearDateRange();
      });

      const [newParams] = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1];
      expect(newParams.get('monitorId')).toBe('5');
      expect(newParams.get('startDateTime')).toBeNull();
      expect(newParams.get('endDateTime')).toBeNull();
    });
  });

  describe('activeFilterCount', () => {
    it('counts each active filter type once', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1', '2']); // counts as 1
        result.current.setSelectedTagIds(['tag-a']);      // counts as 1
        result.current.setFavoritesOnly(true);            // counts as 1
      });

      expect(result.current.activeFilterCount).toBe(3);
    });

    it('counts up to 6 at maximum (all filter types active)', () => {
      const { result } = renderHook(() => useEventFilters());

      act(() => {
        result.current.setSelectedMonitorIds(['1']);
        result.current.setSelectedTagIds(['tag-a']);
        result.current.setStartDateInput('2024-01-01T00:00');
        result.current.setEndDateInput('2024-12-31T23:59');
        result.current.setFavoritesOnly(true);
        result.current.setOnlyDetectedObjects(true);
      });

      expect(result.current.activeFilterCount).toBe(6);
    });
  });

  describe('no profile', () => {
    it('does not crash when currentProfile is null', () => {
      mockCurrentProfileId = null;
      vi.mocked(useCurrentProfile).mockReturnValue({
        currentProfile: null,
        settings: mockProfileSettings as never,
        hasProfile: false,
        isAllMode: false,
      });

      const { result } = renderHook(() => useEventFilters());

      // Should not throw; state setters should still work
      act(() => {
        result.current.setSelectedMonitorIds(['1']);
      });

      expect(result.current.selectedMonitorIds).toEqual(['1']);
      // Settings store should NOT be called because there is no profile ID
      expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
    });
  });
});

// All Servers mode has no current profile, only the ALL sentinel. Filters have
// to persist against that sentinel's bucket, or every selection dies on
// navigation away from the page (refs #337).
describe('useEventFilters in All Servers mode', () => {
  // A settings store that actually stores, so a filter written by one mount is
  // what the next mount reads back. Asserting the write call alone would not
  // show the restore path reading the same bucket.
  let buckets: Record<string, typeof mockProfileSettings>;

  function setupAllMode(saved?: Partial<typeof defaultEventsPageFilters>) {
    mockCurrentProfileId = ALL_PROFILES_ID;
    buckets = {
      [ALL_PROFILES_ID]: {
        defaultEventLimit: 100,
        eventsPageFilters: { ...defaultEventsPageFilters, ...saved },
      },
      'profile-1': { defaultEventLimit: 100, eventsPageFilters: { ...defaultEventsPageFilters } },
    };

    // currentProfile is null in All mode; settings resolve to the ALL bucket,
    // exactly as useCurrentProfile does through the sentinel profile id.
    vi.mocked(useCurrentProfile).mockImplementation(() => ({
      currentProfile: null,
      settings: buckets[mockCurrentProfileId ?? ''] as never,
      hasProfile: false,
      isAllMode: mockCurrentProfileId === ALL_PROFILES_ID,
    }));

    mockGetProfileSettings.mockImplementation((id: string) => buckets[id]);
    mockUpdateProfileSettings.mockImplementation((id: string, updates: Partial<typeof mockProfileSettings>) => {
      buckets[id] = { ...buckets[id], ...updates };
    });
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      getProfileSettings: mockGetProfileSettings,
      updateProfileSettings: mockUpdateProfileSettings,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
    setupAllMode();
  });

  it('writes a filter to the ALL bucket and restores it on the next mount', () => {
    const first = renderHook(() => useEventFilters());
    act(() => {
      first.result.current.setFavoritesOnly(true);
      first.result.current.setActiveQuickRange(6);
    });
    first.unmount();

    expect(mockUpdateProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID, expect.anything());
    expect(buckets[ALL_PROFILES_ID].eventsPageFilters).toMatchObject({ favoritesOnly: true, activeQuickRange: 6 });

    const second = renderHook(() => useEventFilters());
    expect(second.result.current.favoritesOnly).toBe(true);
    expect(second.result.current.activeQuickRange).toBe(6);
  });

  // All-mode monitor selections are composite `${profileId}:${monitorId}`
  // tokens (EventsFilterPopover). The persisted form has to keep the token
  // whole: a bare id restored into All mode would apply profile-a's monitor 3
  // to profile-b's query too, since resolveOwnMonitorIds passes a ':'-less
  // token through to every profile in scope.
  it('round-trips a composite monitor token that no other profile matches', () => {
    const first = renderHook(() => useEventFilters());
    act(() => {
      first.result.current.setSelectedMonitorIds(['profile-a:3']);
    });
    first.unmount();

    const second = renderHook(() => useEventFilters());
    const restored = second.result.current.filters.monitorId;

    expect(resolveOwnMonitorIds(restored, asProfileId('profile-a'))).toBe('3');
    expect(resolveOwnMonitorIds(restored, asProfileId('profile-b'))).toBeUndefined();
    expect(second.result.current.selectedMonitorIds).toEqual(['profile-a:3']);
  });

  it('keeps the ALL bucket filter out of a single profile bucket', () => {
    const inAllMode = renderHook(() => useEventFilters());
    act(() => {
      inAllMode.result.current.setSelectedMonitorIds(['profile-a:3']);
    });
    inAllMode.unmount();

    mockCurrentProfileId = 'profile-1';
    const inSingleMode = renderHook(() => useEventFilters());

    expect(buckets['profile-1'].eventsPageFilters.monitorIds).toEqual([]);
    expect(inSingleMode.result.current.selectedMonitorIds).toEqual([]);
  });
});
