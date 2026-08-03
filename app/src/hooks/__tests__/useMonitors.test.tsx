/**
 * useMonitors' enabled gate used to require isAuthenticated, so a profile
 * that had never authenticated this session (or lost its slice) never
 * fetched. Aligned with useScopedMonitors (refs #337): enabled once there's
 * a profile to fetch for; the API client self-heals an unauthenticated
 * request via its own proactiveLogin path.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useMonitors } from '../useMonitors';
import { useCurrentProfile } from '../useCurrentProfile';
import { useBandwidthSettings } from '../useBandwidthSettings';
import { getCurrentSession } from '../../services/sessions';
import { getMonitors } from '../../api/monitors';
import { asProfileId } from '../../api/types';

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
}));

vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: vi.fn(),
}));

vi.mock('../../services/sessions', () => ({
  getCurrentSession: vi.fn(),
}));

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));

const profileId = asProfileId('profile-a');

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useMonitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: { id: profileId } as never,
      settings: {} as never,
      hasProfile: true,
      isAllMode: false,
    });
    vi.mocked(useBandwidthSettings).mockReturnValue({ monitorStatusInterval: 20000 } as never);
    vi.mocked(getCurrentSession).mockReturnValue({
      profileId,
      client: {} as never,
      timezone: 'UTC',
    });
  });

  it('fetches even when the profile has never authenticated this session', async () => {
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] });

    renderHook(() => useMonitors(), { wrapper });

    await waitFor(() => expect(getMonitors).toHaveBeenCalled());
  });

  it('stays disabled with no current profile', () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null,
      settings: {} as never,
      hasProfile: false,
      isAllMode: false,
    });
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] });

    renderHook(() => useMonitors(), { wrapper });

    expect(getMonitors).not.toHaveBeenCalled();
  });
});
