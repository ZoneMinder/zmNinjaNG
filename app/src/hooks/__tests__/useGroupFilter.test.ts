import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGroupFilter } from '../useGroupFilter';
import { useCurrentProfile } from '../useCurrentProfile';
import { useGroups } from '../useGroups';
import { useSettingsStore } from '../../stores/settings';
import { asProfileId } from '../../api/types';

// Mock dependencies
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
}));

vi.mock('../useGroups', () => ({
  useGroups: vi.fn(),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: vi.fn(),
}));

const mockUpdateProfileSettings = vi.fn();

describe('useGroupFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: null } as never,
      hasProfile: true,
    });

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

    vi.mocked(useSettingsStore).mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector({ updateProfileSettings: mockUpdateProfileSettings } as never);
      }
      return mockUpdateProfileSettings;
    });
  });

  it('returns null selectedGroupId when no filter is active', () => {
    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupId).toBeNull();
    expect(result.current.isFilterActive).toBe(false);
    expect(result.current.filteredMonitorIds).toEqual([]);
  });

  it('returns selected group info when filter is active', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '1' } as never,
      hasProfile: true,
    });

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupId).toBe('1');
    expect(result.current.isFilterActive).toBe(true);
    expect(result.current.filteredMonitorIds).toEqual(['1', '2']);
    expect(result.current.selectedGroupName).toBe('Inside');
  });

  it('setSelectedGroup updates profile settings', () => {
    const { result } = renderHook(() => useGroupFilter());

    act(() => {
      result.current.setSelectedGroup('2');
    });

    expect(mockUpdateProfileSettings).toHaveBeenCalledWith('profile-1', { selectedGroupId: '2' });
  });

  it('clearGroupFilter sets selectedGroupId to null', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '1' } as never,
      hasProfile: true,
    });

    const { result } = renderHook(() => useGroupFilter());

    act(() => {
      result.current.clearGroupFilter();
    });

    expect(mockUpdateProfileSettings).toHaveBeenCalledWith('profile-1', { selectedGroupId: null });
  });

  it('returns null selectedGroupName when no filter is active', () => {
    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupName).toBeNull();
  });

  it('isFilterReady is true when no filter is active', () => {
    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.isFilterReady).toBe(true);
  });

  it('isFilterReady is true when a filter is active and groups have loaded', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '1' } as never,
      hasProfile: true,
    });

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.isFilterReady).toBe(true);
  });

  it('isFilterReady is false when a filter is active but groups have not loaded yet', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '1' } as never,
      hasProfile: true,
    });
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
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '1' } as never,
      hasProfile: true,
    });
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
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '999' } as never,
      hasProfile: true,
    });

    const { result } = renderHook(() => useGroupFilter());

    expect(result.current.selectedGroupName).toBeNull();
  });

  it('does not update settings when no profile is selected', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null,
      settings: { selectedGroupId: null } as never,
      hasProfile: false,
    });

    const { result } = renderHook(() => useGroupFilter());

    act(() => {
      result.current.setSelectedGroup('1');
    });

    expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
  });

  it('resets a dangling selectedGroupId after a successful groups load', async () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '999' } as never,
      hasProfile: true,
    });
    vi.mocked(useGroups).mockReturnValue({
      groups: [{ Group: { Id: '1', Name: 'Front', ParentId: null }, Monitor: [] }],
      isLoading: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: true,
    });
    renderHook(() => useGroupFilter());
    await waitFor(() => {
      expect(mockUpdateProfileSettings).toHaveBeenCalledWith('profile-1', {
        selectedGroupId: null,
      });
    });
  });

  it('does not reset while groups are still loading', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '999' } as never,
      hasProfile: true,
    });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: true,
      isSuccess: false,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });
    renderHook(() => useGroupFilter());
    expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
  });

  it('does not reset when the groups query errored', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '999' } as never,
      hasProfile: true,
    });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: false,
      isSuccess: false,
      error: new Error('offline'),
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });
    renderHook(() => useGroupFilter());
    expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
  });

  // Regression: on cold start the groups query is disabled (auth/profile not
  // ready yet) until login completes. React Query v5 reports isLoading=false
  // for a disabled query, so guarding only on isLoading let the self-heal wipe
  // a valid persisted selection and Montage fell back to streaming all monitors.
  it('does not reset while the groups query is disabled and not yet fetched', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: asProfileId('profile-1'), name: 'Test', apiUrl: '', portalUrl: '', cgiUrl: '', isDefault: true, createdAt: 0 },
      settings: { selectedGroupId: '1' } as never,
      hasProfile: true,
    });
    vi.mocked(useGroups).mockReturnValue({
      groups: [],
      isLoading: false,
      isSuccess: false,
      error: null,
      refetch: vi.fn(),
      getGroupMonitorIds: () => [],
      hasGroups: false,
    });
    renderHook(() => useGroupFilter());
    expect(mockUpdateProfileSettings).not.toHaveBeenCalled();
  });
});
