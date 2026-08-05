/**
 * usePermissions against the real profile store.
 *
 * The hook subscribes to the profile store for the account name, so it is
 * exercised against the actual store rather than a `(selector) => selector(state)`
 * stub: that stub cannot reproduce the re-render loop a selector minting a new
 * object would cause in production (testing playbook).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePermissions } from '../usePermissions';
import { fetchAccountPermissions } from '../../api/users';
import { useProfileStore } from '../../stores/profile';
import { asProfileId, VIRTUAL_PROFILE_ID_PREFIX, type Profile } from '../../api/types';
import { SYSTEM_NONE_PERMISSIONS } from '../../lib/permissions/zm-permissions';

vi.mock('../../api/users', () => ({ fetchAccountPermissions: vi.fn() }));

// Partial for the same reason as sessions below: the real profile store wires
// itself to this module's registration functions at import time.
vi.mock('../../stores/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/auth')>()),
  useAuthSlice: () => ({ isAuthenticated: true }),
}));

// Partial: the profile store registers its own gate against this module on
// import, so the real exports have to survive the mock.
vi.mock('../../services/sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sessions')>()),
  getSession: vi.fn(() => ({ client: {} })),
}));

const profileId = asProfileId('profile-1');

const profile: Profile = {
  id: profileId,
  name: 'Home',
  portalUrl: 'https://zm.test/zm',
  apiUrl: 'https://zm.test/zm/api',
  cgiUrl: 'https://zm.test/zm/cgi-bin',
  username: 'viewer',
  isDefault: true,
  createdAt: 0,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('usePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileStore.setState({ profiles: [profile], currentProfileId: profileId });
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
