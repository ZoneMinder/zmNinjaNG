import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query';
import React from 'react';
import { useScopedMonitors } from '../useScopedMonitors';
import { useBandwidthSettings } from '../useBandwidthSettings';
import { getMonitors } from '../../api/monitors';
import { queryKeys } from '../../lib/query/query-keys';
import { ALL_PROFILES_ID, asProfileId, type Profile } from '../../api/types';
import type { ApiClient } from '../../api/client';
import type { MonitorData } from '../../api/types';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));

// Spy on the real useQueries (delegates to actual react-query) so the
// stagger test can inspect exactly what query config the hook builds,
// without needing fake timers to prove a refetch never fires.
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const useQueriesSpy = vi.fn((options: unknown) => (actual.useQueries as (o: unknown) => unknown)(options));
  return { ...actual, useQueries: useQueriesSpy };
});

// useBandwidthSettings reads settings through the real useCurrentProfile,
// which would require per-test profile settings scripting for one number;
// kept as a direct mock (a plain data hook, not a store) since only its
// numeric output matters to this suite's stagger assertions.
vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: vi.fn(),
}));

const profileA: Profile = {
  id: asProfileId('profile-a'),
  name: 'Home',
  apiUrl: 'http://a/api',
  portalUrl: 'http://a',
  cgiUrl: 'http://a/cgi-bin',
  isDefault: true,
  createdAt: 0,
};

const profileB: Profile = {
  id: asProfileId('profile-b'),
  name: 'Work',
  apiUrl: 'http://b/api',
  portalUrl: 'http://b',
  cgiUrl: 'http://b/cgi-bin',
  isDefault: false,
  createdAt: 0,
};

function monitor(id: string, name: string): MonitorData {
  return { Monitor: { Id: id, Name: name } } as MonitorData;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/** Seed the real profile store for the given scope and give each profile a
 * distinguishable fake session client (getMonitors is mocked directly, so
 * the client only needs to carry which profile it belongs to). */
function setupScope(profiles: Profile[], mode: 'single' | 'all' = profiles.length === 1 ? 'single' : 'all') {
  seedProfiles(profiles, { current: mode === 'single' ? profiles[0].id : ALL_PROFILES_ID });
  for (const p of profiles) {
    installApiClient(p.id, { profile: p.id } as unknown as ApiClient);
  }
}

describe('useScopedMonitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBandwidthSettings).mockReturnValue({
      monitorStatusInterval: 20000,
    } as never);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('keeps colliding monitor ids distinct across profiles, tagged with the right profile', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getMonitors).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return { monitors: [monitor('1', isA ? 'Front Door (A)' : 'Front Door (B)')] };
    });

    const { result } = renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.monitors).toHaveLength(2));

    const [first, second] = result.current.monitors;
    expect(first.profileId).toBe(profileA.id);
    expect(first.profileName).toBe('Home');
    expect(first.item.Monitor.Name).toBe('Front Door (A)');
    expect(second.profileId).toBe(profileB.id);
    expect(second.profileName).toBe('Work');
    expect(second.item.Monitor.Name).toBe('Front Door (B)');
    // Same server-side id "1" on both profiles stays two distinct entries.
    expect(first.item.Monitor.Id).toBe(second.item.Monitor.Id);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errors).toEqual([]);
  });

  it('surfaces one failing profile as a ProfileError while the other profile still renders its data', async () => {
    setupScope([profileA, profileB]);
    const failure = new Error('B is down');
    vi.mocked(getMonitors).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      if (!isA) throw failure;
      return { monitors: [monitor('1', 'Front Door')] };
    });

    const { result } = renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.errors).toHaveLength(1));

    expect(result.current.errors[0].profileId).toBe(profileB.id);
    expect(result.current.errors[0].profileName).toBe('Work');
    expect(result.current.errors[0].error).toBe(failure);
    expect(result.current.monitors).toHaveLength(1);
    expect(result.current.monitors[0].profileId).toBe(profileA.id);
    expect(result.current.isLoading).toBe(false);
  });

  it('single-mode profile scope writes to the exact key useMonitors reads, so the cache entry is shared', async () => {
    setupScope([profileA], 'single');
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('42', 'Driveway')] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useScopedMonitors(), { wrapper });
    await waitFor(() => expect(result.current.monitors).toHaveLength(1));

    // getMonitors called with this profile's session client and id - the
    // exact call useMonitors makes for the current profile.
    expect(vi.mocked(getMonitors).mock.calls[0][1]).toBe(profileA.id);
    expect(result.current.monitors[0].item).toEqual(monitor('42', 'Driveway'));

    // Cache entry lives at queryKeys.monitors(id) - IDENTICAL to useMonitors'
    // key - so a single-mode surface using useMonitors reads this same data
    // without a second network round trip.
    expect(queryClient.getQueryData(queryKeys.monitors(profileA.id))).toEqual({
      monitors: [monitor('42', 'Driveway')],
    });
  });

  it('is not loading once at least one profile has data, even if others are still pending', async () => {
    setupScope([profileA, profileB]);
    let resolveB: (v: { monitors: MonitorData[] }) => void = () => {};
    vi.mocked(getMonitors).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      if (isA) return { monitors: [monitor('1', 'A mon')] };
      return new Promise((resolve) => {
        resolveB = resolve;
      });
    });

    const { result } = renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.monitors).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);

    resolveB({ monitors: [monitor('2', 'B mon')] });
    await waitFor(() => expect(result.current.monitors).toHaveLength(2));
  });

  it('refetchProfile(id) refetches only that profile', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('1', 'Mon')] });

    const { result } = renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.monitors).toHaveLength(2));

    const callsBefore = vi.mocked(getMonitors).mock.calls.length;
    result.current.refetchProfile(profileB.id);

    await waitFor(() => expect(vi.mocked(getMonitors).mock.calls.length).toBeGreaterThan(callsBefore));
    const refetchCallClient = vi.mocked(getMonitors).mock.calls[vi.mocked(getMonitors).mock.calls.length - 1][0];
    expect((refetchCallClient as unknown as { profile: string }).profile).toBe(profileB.id);
  });

  it('keeps monitors/errors array identity across an unrelated rerender (combine + replaceEqualDeep)', async () => {
    // Without useQueries' combine option, useQueries reconstructs its
    // top-level result array from scratch on every render (getOptimisticResult
    // remaps the observers via .map() unconditionally), so any merge done in
    // an external useMemo keyed on that array produces brand-new object
    // identities on every render - even one triggered by something entirely
    // unrelated (a parent state change, another store tick) where the
    // monitor data itself hasn't changed at all. Verified empirically: this
    // exact assertion FAILS (arrays differ by reference) against a plain
    // useMemo-over-the-raw-array implementation and only holds once the
    // merge lives inside combine, whose output QueriesObserver deep-diffs
    // against the previous combined result via replaceEqualDeep, reusing old
    // references for unchanged data.
    setupScope([profileA], 'single');
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('1', 'Front Door')] });

    const { result, rerender } = renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.monitors).toHaveLength(1));

    const monitorsRef = result.current.monitors;
    const errorsRef = result.current.errors;

    // Force the hook to re-run with no data change at all - simulates a
    // rerender caused by something outside this hook's own state.
    rerender();

    expect(result.current.monitors).toBe(monitorsRef);
    expect(result.current.errors).toBe(errorsRef);
  });

  it('fetches every profile in scope even when neither has ever authenticated this session (refs #337)', async () => {
    setupScope([profileA, profileB]);
    // Neither profile has an auth slice at all - the state an All-mode
    // profile is in until something touches it this session. The old gate
    // (isAuthenticated) left it disabled forever, so its query never fired
    // and it silently never appeared. The fix enables it regardless and
    // lets the API client's own proactiveLogin self-heal on first request.
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('1', 'Mon')] });

    renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });

    await waitFor(() => {
      const calledProfileIds = vi.mocked(getMonitors).mock.calls.map(([, id]) => id);
      expect(calledProfileIds).toContain(profileB.id);
    });
  });

  it('staggers each profile query refetchInterval so N profiles do not poll in a synchronized burst (W8)', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('1', 'Mon')] });

    renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(useQueries).mock.calls.length).toBeGreaterThan(0));
    const { queries } = vi.mocked(useQueries).mock.calls[0][0] as { queries: Array<{ refetchInterval?: number }> };
    expect(queries).toHaveLength(2);
    // Index 0 keeps the base interval exactly; index 1 gets a distinct,
    // bounded-larger period (stagger-interval.ts) instead of the identical
    // shared interval both profiles used before.
    expect(queries[0].refetchInterval).toBe(20000);
    expect(queries[1].refetchInterval).toBeGreaterThan(20000);
    expect(queries[1].refetchInterval).toBeLessThanOrEqual(20000 * 1.5);
  });

  it('poll:false leaves every profile query without an interval, so an app-wide consumer adds no polling', async () => {
    setupScope([profileA, profileB]);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('1', 'Mon')] });

    renderHook(() => useScopedMonitors({ poll: false }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(useQueries).mock.calls.length).toBeGreaterThan(0));
    const { queries } = vi.mocked(useQueries).mock.calls[0][0] as { queries: Array<{ refetchInterval?: number }> };
    expect(queries).toHaveLength(2);
    // The palette and the keyboard shortcuts mount for the whole session and
    // only need a lookup table; an interval here would poll every profile's
    // monitor list on every page (refs #337).
    expect(queries[0].refetchInterval).toBeUndefined();
    expect(queries[1].refetchInterval).toBeUndefined();
  });

  it('refetchProfile still triggers a real network refetch under combine', async () => {
    setupScope([profileA], 'single');
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [monitor('1', 'Front Door')] });

    const { result } = renderHook(() => useScopedMonitors(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.monitors).toHaveLength(1));

    const callsBefore = vi.mocked(getMonitors).mock.calls.length;
    await act(async () => {
      result.current.refetchProfile(profileA.id);
      await waitFor(() => expect(vi.mocked(getMonitors).mock.calls.length).toBeGreaterThan(callsBefore));
    });
  });
});
