import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGroupFilter } from '../useGroupFilter';
import { useGroups } from '../useGroups';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../useGroups', () => ({
  useGroups: vi.fn(),
}));

import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';

function mockGroups() {
  vi.mocked(useGroups).mockReturnValue({
    groups: [
      {
        Group: { Id: '1', Name: 'Inside', ParentId: null },
        Monitor: [{ Id: '1' }, { Id: '2' }],
      },
      {
        Group: { Id: '2', Name: 'Outside', ParentId: null },
        Monitor: [{ Id: '3' }],
      },
    ],
    isLoading: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
    getGroupMonitorIds: vi.fn((groupId: string) => {
      if (groupId === '1') return ['1', '2'];
      if (groupId === '2') return ['3'];
      return [];
    }),
    hasGroups: true,
  });
}

describe('useGroupFilter', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('returns null selectedGroupId when no filter is active', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupId).toBeNull();
    expect(result.current.isFilterActive).toBe(false);
    expect(result.current.filteredMonitorIds).toEqual([]);
  });

  it('returns selected group info when filter is active', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '1' } } });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupId).toBe('1');
    expect(result.current.isFilterActive).toBe(true);
    expect(result.current.filteredMonitorIds).toEqual(['1', '2']);
    expect(result.current.selectedGroupName).toBe('Inside');
  });

  it('setSelectedGroup updates profile settings', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    act(() => {
      result.current.setSelectedGroup('2');
    });

    expect(useSettingsStore.getState().getProfileSettings('profile-1').selectedGroupId).toBe('2');
  });

  it('clearGroupFilter sets selectedGroupId to null', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '1' } } });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    act(() => {
      result.current.clearGroupFilter();
    });

    expect(useSettingsStore.getState().getProfileSettings('profile-1').selectedGroupId).toBeNull();
  });

  it('returns null selectedGroupName when no filter is active', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupName).toBeNull();
  });

  it('isFilterReady is true when no filter is active', () => {
    seedProfiles(['profile-1'], { current: 'profile-1' });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.isFilterReady).toBe(true);
  });

  it('isFilterReady is true when a filter is active and groups have loaded', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '1' } } });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.isFilterReady).toBe(true);
  });

  it('isFilterReady is false when a filter is active but groups have not loaded yet', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '1' } } });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: false,
      isSuccess: false,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.isFilterReady).toBe(false);
  });

  it('isFilterReady is true when a filter is active but the groups query errored', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '1' } } });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: false,
      isSuccess: false,
      error: new Error('offline'),
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.isFilterReady).toBe(true);
  });

  it('returns null selectedGroupName when selected group does not exist', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '999' } } });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupName).toBeNull();
  });

  it('does not update settings when no profile is selected', () => {
    seedProfiles([], { current: null });
    mockGroups();

    const { result } = renderHook(() => useGroupFilter());

    act(() => {
      result.current.setSelectedGroup('1');
    });

    // No profile to write to: the bucket for an unrelated id stays untouched
    // and the hook's own state stays null.
    expect(result.current.selectedGroupId).toBeNull();
  });

  it('resets a dangling selectedGroupId after a successful groups load', async () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '999' } } });
    vi.mocked(useGroups).mockReturnValue({
      groups: [{ Group: { Id: '1', Name: 'Front', ParentId: null }, Monitor: [] }],
      isLoading: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: true,
    });
    const { result } = renderHook(() => useGroupFilter());
    await waitFor(() => {
      expect(result.current.selectedGroupId).toBeNull();
    });
    expect(useSettingsStore.getState().getProfileSettings('profile-1').selectedGroupId).toBeNull();
  });

  it('does not reset while groups are still loading', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '999' } } });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: true,
      isSuccess: false,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });
    const { result } = renderHook(() => useGroupFilter());
    expect(result.current.selectedGroupId).toBe('999');
  });

  it('does not reset when the groups query errored', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '999' } } });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: false,
      isSuccess: false,
      error: new Error('offline'),
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });
    const { result } = renderHook(() => useGroupFilter());
    expect(result.current.selectedGroupId).toBe('999');
  });

  // Regression: on cold start the groups query is disabled (auth/profile not
  // ready yet) until login completes. React Query v5 reports isLoading=false
  // for a disabled query, so guarding only on isLoading let the self-heal wipe
  // a valid persisted selection and Montage fell back to streaming all monitors.
  it('does not reset while the groups query is disabled and not yet fetched', () => {
    seedProfiles(['profile-1'], { current: 'profile-1', settings: { 'profile-1': { selectedGroupId: '1' } } });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: false,
      isSuccess: false,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });
    const { result } = renderHook(() => useGroupFilter());
    expect(result.current.selectedGroupId).toBe('1');
  });
});
