/**
 * useTimelineFilters Hook Tests
 *
 * Focus on the Event Cause filter: state, persistence, restore, and counting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineFilters } from '../useTimelineFilters';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

const mockCurrentProfile = { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 };
const mockGetProfileSettings = vi.fn();
const mockUpdateProfileSettings = vi.fn();

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

// Filters persist against currentProfileId: the ALL sentinel in All mode, a
// real profile id in single mode.
let mockCurrentProfileId: string | null = 'profile-1';
vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string | null }) => unknown) =>
    selector({ currentProfileId: mockCurrentProfileId }),
}));

import { useCurrentProfile } from '../useCurrentProfile';
import { useSettingsStore } from '../../stores/settings';

const defaultTimelineFilters = {
  monitorIds: [],
  startDateTime: '',
  endDateTime: '',
  onlyDetectedObjects: false,
  causeFilter: '',
  activeQuickRange: null,
};

function setupMocks(filterOverrides?: Partial<typeof defaultTimelineFilters>) {
  const timelinePageFilters = { ...defaultTimelineFilters, ...filterOverrides };
  const settings = { timelinePageFilters };
  mockCurrentProfileId = 'profile-1';

  vi.mocked(useCurrentProfile).mockReturnValue({
    currentProfile: mockCurrentProfile,
    settings: settings as never,
    hasProfile: true,
    isAllMode: false,
  });

  mockGetProfileSettings.mockReturnValue(settings);

  vi.mocked(useSettingsStore.getState).mockReturnValue({
    getProfileSettings: mockGetProfileSettings,
    updateProfileSettings: mockUpdateProfileSettings,
  } as never);
}

describe('useTimelineFilters cause filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('defaults causeFilter to empty and counts 0', () => {
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.causeFilter).toBe('');
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('updates causeFilter and counts it as one active filter', () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('motion_detected');
    });

    expect(result.current.causeFilter).toBe('motion_detected');
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('persists causeFilter to the settings store', () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('Continuous');
    });

    expect(mockUpdateProfileSettings).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        timelinePageFilters: expect.objectContaining({ causeFilter: 'Continuous' }),
      }),
    );
  });

  it('restores a persisted causeFilter on mount', () => {
    setupMocks({ causeFilter: 'Signal' });
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.causeFilter).toBe('Signal');
  });

  it('clears causeFilter via clearFilters', () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => {
      result.current.setCauseFilter('Forced');
    });
    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.causeFilter).toBe('');
    expect(result.current.activeFilterCount).toBe(0);
  });
});

// All Servers mode has no current profile, only the ALL sentinel, so filters
// have to persist against that sentinel's bucket (refs #337).
describe('useTimelineFilters in All Servers mode', () => {
  // A settings store that actually stores, so the second mount reads back what
  // the first one wrote rather than just proving a spy was called.
  let buckets: Record<string, { timelinePageFilters: typeof defaultTimelineFilters }>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentProfileId = ALL_PROFILES_ID;
    buckets = {
      [ALL_PROFILES_ID]: { timelinePageFilters: { ...defaultTimelineFilters } },
      'profile-1': { timelinePageFilters: { ...defaultTimelineFilters } },
    };

    vi.mocked(useCurrentProfile).mockImplementation(() => ({
      currentProfile: null,
      settings: buckets[mockCurrentProfileId ?? ''] as never,
      hasProfile: false,
      isAllMode: mockCurrentProfileId === ALL_PROFILES_ID,
    }));

    mockGetProfileSettings.mockImplementation((id: string) => buckets[id]);
    mockUpdateProfileSettings.mockImplementation(
      (id: string, updates: { timelinePageFilters: typeof defaultTimelineFilters }) => {
        buckets[id] = { ...buckets[id], ...updates };
      },
    );
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      getProfileSettings: mockGetProfileSettings,
      updateProfileSettings: mockUpdateProfileSettings,
    } as never);
  });

  it('writes a filter to the ALL bucket and restores it on the next mount', () => {
    const first = renderHook(() => useTimelineFilters());
    act(() => {
      first.result.current.setCauseFilter('Motion');
      first.result.current.setActiveQuickRange(12);
    });
    first.unmount();

    expect(buckets[ALL_PROFILES_ID].timelinePageFilters).toMatchObject({
      causeFilter: 'Motion',
      activeQuickRange: 12,
    });

    const second = renderHook(() => useTimelineFilters());
    expect(second.result.current.causeFilter).toBe('Motion');
    expect(second.result.current.activeQuickRange).toBe(12);
  });

  it('keeps the ALL bucket filter out of a single profile bucket', () => {
    const inAllMode = renderHook(() => useTimelineFilters());
    act(() => {
      inAllMode.result.current.setCauseFilter('Motion');
    });
    inAllMode.unmount();

    mockCurrentProfileId = 'profile-1';
    const inSingleMode = renderHook(() => useTimelineFilters());

    expect(buckets['profile-1'].timelinePageFilters.causeFilter).toBe('');
    expect(inSingleMode.result.current.causeFilter).toBe('');
  });
});
