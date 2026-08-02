import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useScopedMonitors } from '../useScopedMonitors';
import { useProfileScope, type ProfileScope } from '../useProfileScope';
import { useBandwidthSettings } from '../useBandwidthSettings';
import { getMonitors } from '../../api/monitors';
import { getSession } from '../../services/sessions';
import { useAuthStore } from '../../stores/auth';
import { queryKeys } from '../../lib/query/query-keys';
import { asProfileId } from '../../api/types';
import type { MonitorData } from '../../api/types';

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));

vi.mock('../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock('../useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));

vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: vi.fn(),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}));

const profileA = {
  id: asProfileId('profile-a'),
  name: 'Home',
  apiUrl: 'http://a/api',
  portalUrl: 'http://a',
  cgiUrl: 'http://a/cgi-bin',
  isDefault: true,
  createdAt: 0,
};

const profileB = {
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

const AUTHENTICATED_SLICE = { isAuthenticated: true, requiresAuth: true };

function mockScope(profiles: Array<typeof profileA>, mode: 'single' | 'all' = profiles.length === 1 ? 'single' : 'all') {
  const scope =
    mode === 'single'
      ? { mode: 'single' as const, profile: profiles[0], profiles: [profiles[0]] as [typeof profileA], settings: {} }
      : { mode: 'all' as const, profile: null, profiles, settings: {} };
  vi.mocked(useProfileScope).mockReturnValue(scope as unknown as ProfileScope);
}

function mockAuthSlices(slices: Record<string, { isAuthenticated: boolean; requiresAuth: boolean }>) {
  vi.mocked(useAuthStore).mockImplementation((selector: unknown) =>
    (selector as (s: { slices: typeof slices }) => unknown)({ slices })
  );
}

function sessionFor(p: typeof profileA) {
  return {
    profileId: p.id,
    client: { profile: p.id } as unknown as import('../../api/client').ApiClient,
    timezone: 'UTC',
  };
}

describe('useScopedMonitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBandwidthSettings).mockReturnValue({
      monitorStatusInterval: 20000,
    } as never);
    vi.mocked(getSession).mockImplementation((id) => {
      const p = [profileA, profileB].find((pr) => pr.id === id);
      return sessionFor(p ?? profileA);
    });
  });

  it('keeps colliding monitor ids distinct across profiles, tagged with the right profile', async () => {
    mockScope([profileA, profileB]);
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE, [profileB.id]: AUTHENTICATED_SLICE });
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
    mockScope([profileA, profileB]);
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE, [profileB.id]: AUTHENTICATED_SLICE });
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
    mockScope([profileA], 'single');
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE });
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
    mockScope([profileA, profileB]);
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE, [profileB.id]: AUTHENTICATED_SLICE });
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
    mockScope([profileA, profileB]);
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE, [profileB.id]: AUTHENTICATED_SLICE });
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
    mockScope([profileA], 'single');
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE });
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

  it('refetchProfile still triggers a real network refetch under combine', async () => {
    mockScope([profileA], 'single');
    mockAuthSlices({ [profileA.id]: AUTHENTICATED_SLICE });
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
