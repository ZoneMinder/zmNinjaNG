/**
 * usePermissions against the real profile store.
 *
 * The hook subscribes to the profile store for the account name, so it is
 * exercised against the actual store rather than a `(selector) => selector(state)`
 * stub: that stub cannot reproduce the re-render loop a selector minting a new
 * object would cause in production (testing playbook).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../api/users', () => ({ fetchAccountPermissions: vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { usePermissions } from '../usePermissions';
import { fetchAccountPermissions } from '../../api/users';
import { useProfileStore } from '../../stores/profile';
import { VIRTUAL_PROFILE_ID_PREFIX } from '../../api/types';
import { SYSTEM_NONE_PERMISSIONS } from '../../lib/permissions/zm-permissions';
import { seedProfiles, resetProfileFixture, makeProfile, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

const profileId = asProfileId('profile-1');
const profile = makeProfile('profile-1', { username: 'viewer' });

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('usePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles([profile]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('reports the account permissions for the requested profile', async () => {
    vi.mocked(fetchAccountPermissions).mockResolvedValue({ system: 'View', stream: 'None' });

    const { result } = renderHook(() => usePermissions(profileId), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.permissions).toEqual({ system: 'View', stream: 'None' }));
    expect(fetchAccountPermissions).toHaveBeenCalledWith(expect.anything(), 'viewer');
  });

  it('keeps everything unknown until the probe resolves', async () => {
    let release: (value: typeof SYSTEM_NONE_PERMISSIONS) => void = () => {};
    vi.mocked(fetchAccountPermissions).mockReturnValue(
      new Promise((resolve) => { release = resolve; }),
    );

    const { result } = renderHook(() => usePermissions(profileId), { wrapper: createWrapper() });

    expect(result.current.permissions).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    release(SYSTEM_NONE_PERMISSIONS);
    await waitFor(() => expect(result.current.permissions).toEqual(SYSTEM_NONE_PERMISSIONS));
  });

  it('does not probe an aggregate, which has no account of its own', () => {
    const { result } = renderHook(() => usePermissions(asProfileId(`${VIRTUAL_PROFILE_ID_PREFIX}all-cameras`)), {
      wrapper: createWrapper(),
    });

    expect(fetchAccountPermissions).not.toHaveBeenCalled();
    expect(result.current.permissions).toBeUndefined();
  });

  it('re-renders without looping when the store updates', async () => {
    vi.mocked(fetchAccountPermissions).mockResolvedValue({ system: 'Edit' });

    const { result, rerender } = renderHook(() => usePermissions(profileId), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.permissions).toEqual({ system: 'Edit' }));

    // An unrelated store write must not churn this subscription.
    useProfileStore.setState({ profiles: [{ ...profile, lastUsed: 1 }] });
    rerender();

    expect(result.current.permissions).toEqual({ system: 'Edit' });
  });
});
