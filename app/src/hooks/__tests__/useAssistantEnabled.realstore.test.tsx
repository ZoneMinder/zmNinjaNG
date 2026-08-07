/**
 * useAssistantEnabled real-store regression test (refs #337).
 *
 * The bug this covers: assistant settings are server-scoped (Settings writes
 * the picked member's bucket while an aggregate is selected), but the entry
 * points read `scope.settings`, which for a group is the group's own bucket -
 * a bucket nothing ever writes `assistantEnabled` into. Ninjii was therefore
 * unreachable from every virtual profile. Renders against the REAL stores so
 * the subscription shape is exercised, not a `(selector) => selector(state)`
 * stub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAssistantEnabled } from '../useAssistantEnabled';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { asProfileId } from '../../api/types';

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

describe('useAssistantEnabled against the real stores', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [server('p1', 'Home'), server('p2', 'Away'), server('p3', 'Shed')],
      virtualProfiles: [],
      currentProfileId: asProfileId('p1'),
      isInitialized: true,
    });
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('follows the current profile in single mode', () => {
    const { result, rerender } = renderHook(() => useAssistantEnabled());
    expect(result.current.enabled).toBe(false);

    act(() =>
      useSettingsStore.getState().updateProfileSettings(asProfileId('p1'), { assistantEnabled: true })
    );
    rerender();

    expect(result.current.enabled).toBe(true);
    expect(result.current.profileId).toBe('p1');
  });

  it('enables inside a group when a member has the assistant on', () => {
    act(() =>
      useSettingsStore.getState().updateProfileSettings(asProfileId('p3'), { assistantEnabled: true })
    );
    const id = useProfileStore.getState().addVirtualProfile('Upstairs', [
      asProfileId('p1'),
      asProfileId('p3'),
    ]);

    const { result } = renderHook(() => useAssistantEnabled());
    act(() => useProfileStore.setState({ currentProfileId: id }));

    // The group's own settings bucket has assistantEnabled false; the member
    // that carries the configuration is what the entry points must see.
    expect(result.current.enabled).toBe(true);
    expect(result.current.profileId).toBe('p3');
  });

  it('stays off in a group whose members all have the assistant off', () => {
    act(() =>
      useSettingsStore.getState().updateProfileSettings(asProfileId('p2'), { assistantEnabled: true })
    );
    const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);

    const { result } = renderHook(() => useAssistantEnabled());
    act(() => useProfileStore.setState({ currentProfileId: id }));

    expect(result.current.enabled).toBe(false);
    // Still names a profile: the panel pins to the first member regardless.
    expect(result.current.profileId).toBe('p1');
  });
});
