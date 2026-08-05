/**
 * useProfileScope real-store regression test (refs #337).
 *
 * The isolated test mocks the profile store as `(selector) => selector(state)`,
 * which cannot see the failure mode that matters for a new subscription: a
 * selector that mints a fresh object or array each call re-renders forever
 * through useSyncExternalStore, and useShallow never stabilizes it. The
 * virtualProfiles subscription added here is exactly that shape, so it renders
 * against the REAL store (seeded via getState) and asserts the resolved scope,
 * not just that nothing crashed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProfileScope } from '../useProfileScope';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));

vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn(),
  getSecureValue: vi.fn(),
  removeSecureValue: vi.fn(),
}));

const server = (id: string, name: string) => ({
  id: asProfileId(id),
  name,
  apiUrl: `http://${id}`,
  portalUrl: `http://${id}`,
  cgiUrl: `http://${id}/cgi-bin`,
  isDefault: false,
  createdAt: 1,
});

describe('useProfileScope against the real store', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [server('p1', 'Home'), server('p2', 'Away'), server('p3', 'Shed')],
      virtualProfiles: [],
      currentProfileId: asProfileId('p1'),
      isInitialized: true,
    });
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('resolves a group to its members without looping the render', () => {
    const id = useProfileStore
      .getState()
      .addVirtualProfile('Upstairs', [asProfileId('p1'), asProfileId('p3')]);
    useSettingsStore.getState().updateProfileSettings(id, { streamMaxFps: 11 });
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { streamMaxFps: 42 });

    const { result } = renderHook(() => useProfileScope());
    // Selecting the group is the state change a looping selector would
    // amplify: the scope has to settle on the members, once.
    act(() => useProfileStore.setState({ currentProfileId: id }));

    expect(result.current?.mode).toBe('all');
    expect(result.current?.profiles.map((p) => p.name)).toEqual(['Home', 'Shed']);
    expect(result.current?.mode === 'all' && result.current.aggregateName).toBe('Upstairs');
    expect(result.current?.settings.streamMaxFps).toBe(11);
  });

  it('follows a membership edit without re-entering the store', () => {
    const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
    useProfileStore.setState({ currentProfileId: id });

    const { result, rerender } = renderHook(() => useProfileScope());
    act(() =>
      useProfileStore.getState().updateVirtualProfile(id, {
        memberProfileIds: [asProfileId('p2'), asProfileId('p3')],
      })
    );
    rerender();

    expect(result.current?.profiles.map((p) => p.name)).toEqual(['Away', 'Shed']);
  });

  it('collapses to null when the selected group is deleted', () => {
    const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
    useProfileStore.setState({ currentProfileId: id });

    const { result, rerender } = renderHook(() => useProfileScope());
    act(() => useProfileStore.getState().deleteVirtualProfile(id));
    rerender();

    expect(result.current).toBeNull();
  });
});
