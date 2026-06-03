import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMontageGroupState } from '../useMontageGroupState';
import { useSettingsStore, ALL_GROUPS_KEY } from '../../stores/settings';

const mockSelectedGroupId = { value: null as string | null };

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-a' },
    settings: useSettingsStore.getState().getProfileSettings('profile-a'),
  }),
}));

vi.mock('../useGroupFilter', () => ({
  useGroupFilter: () => ({ selectedGroupId: mockSelectedGroupId.value }),
}));

describe('useMontageGroupState', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
    mockSelectedGroupId.value = null;
  });

  it('uses ALL_GROUPS_KEY when no group is selected', () => {
    const { result } = renderHook(() => useMontageGroupState());
    expect(result.current.groupKey).toBe(ALL_GROUPS_KEY);
    expect(result.current.bucket.gridCols).toBe(2);
  });

  it('uses the selected group ID as the key', () => {
    mockSelectedGroupId.value = '7';
    const { result } = renderHook(() => useMontageGroupState());
    expect(result.current.groupKey).toBe('7');
  });

  it('update() writes a patch to the current group bucket', () => {
    mockSelectedGroupId.value = '7';
    const { result } = renderHook(() => useMontageGroupState());
    act(() => result.current.update({ gridCols: 5 }));
    const bucket = useSettingsStore
      .getState()
      .getProfileSettings('profile-a').montageByGroup['7'];
    expect(bucket.gridCols).toBe(5);
  });
});
