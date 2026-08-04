import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMontageGroupState } from '../useMontageGroupState';
import { useSettingsStore, ALL_GROUPS_KEY } from '../../stores/settings';
import { ALL_PROFILES_ID } from '../../api/types';

const mockSelectedGroupId = { value: null as string | null };
// Write target: a real profile id in single mode, the ALL sentinel in All
// mode (where currentProfile stays null).
const mockCurrentProfileId = { value: 'profile-a' as string | null };

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string | null }) => unknown) =>
    selector({ currentProfileId: mockCurrentProfileId.value }),
}));

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile:
      mockCurrentProfileId.value === ALL_PROFILES_ID
        ? null
        : { id: mockCurrentProfileId.value },
    settings: useSettingsStore
      .getState()
      .getProfileSettings(mockCurrentProfileId.value ?? ''),
  }),
}));

vi.mock('../useGroupFilter', () => ({
  useGroupFilter: () => ({ selectedGroupId: mockSelectedGroupId.value }),
}));

describe('useMontageGroupState', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
    mockSelectedGroupId.value = null;
    mockCurrentProfileId.value = 'profile-a';
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

  // All mode has no real profile, but montage layout is a view preference:
  // the ALL bucket owns it there, so update() must persist rather than being
  // inert (refs #337).
  it('update() writes to the ALL bucket in All mode', () => {
    mockCurrentProfileId.value = ALL_PROFILES_ID;
    const { result } = renderHook(() => useMontageGroupState());
    act(() => result.current.update({ gridCols: 4 }));
    const bucket = useSettingsStore
      .getState()
      .getProfileSettings(ALL_PROFILES_ID).montageByGroup[ALL_GROUPS_KEY];
    expect(bucket.gridCols).toBe(4);
  });

  // The bucket the hook reports must be the one update() writes, or the page
  // renders single-mode values while persisting ALL-bucket ones.
  it('reads the ALL bucket in All mode', () => {
    mockCurrentProfileId.value = ALL_PROFILES_ID;
    useSettingsStore
      .getState()
      .updateMontageGroupLayout(ALL_PROFILES_ID, ALL_GROUPS_KEY, { gridCols: 3 });
    const { result } = renderHook(() => useMontageGroupState());
    expect(result.current.bucket.gridCols).toBe(3);
  });
});
