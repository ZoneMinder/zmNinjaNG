/**
 * useMonitors' enabled gate used to require isAuthenticated, so a profile
 * that had never authenticated this session (or lost its slice) never
 * fetched. Aligned with useScopedMonitors (refs #337): enabled once there's
 * a profile to fetch for; the API client self-heals an unauthenticated
 * request via its own proactiveLogin path.
 *
 * Runs against the real profile, settings and auth stores and the real
 * session registry; only the HTTP client is fake (tests/profile-fixture).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useMonitors } from '../useMonitors';
import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

const monitorsBody = {
  monitors: [
    { Monitor: { Id: '1', Name: 'Door', Function: 'Modect', Enabled: '1' } },
    { Monitor: { Id: '2', Name: 'Yard', Function: 'None', Enabled: '1', Deleted: true } },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useMonitors', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fetches even when the profile has never authenticated this session', async () => {
    seedProfiles(['a'], { authenticated: false });
    const client = fakeApiClient({ '/servers.json': { servers: [] }, '/monitors.json': monitorsBody });
    installApiClient(asProfileId('a'), client);

    const { result } = renderHook(() => useMonitors(), { wrapper });

    // getMonitors drops deleted monitors before the hook filters, so 'Yard'
    // never reaches it; asserting the server sent two and the hook shows one
    // is the outcome that would change if either layer regressed.
    await waitFor(() => expect(result.current.monitors.map((m) => m.Monitor.Name)).toEqual(['Door']));
    expect(result.current.enabledMonitorIds).toEqual(['1']);
    expect(client.calls.map((c) => c.url)).toContain('/monitors.json');
  });

  it('stays disabled with no current profile', async () => {
    seedProfiles([], { current: null });
    const client = fakeApiClient({ '/monitors.json': monitorsBody });
    installApiClient(asProfileId('a'), client);

    const { result } = renderHook(() => useMonitors(), { wrapper });

    // Give a wrongly-enabled query every chance to fire before asserting it did not.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.monitors).toEqual([]);
    expect(client.calls).toEqual([]);
  });
});
