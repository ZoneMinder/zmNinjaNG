import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query';
import React from 'react';
import { useScopedEvents } from '../useScopedEvents';
import { useProfileScope, type ProfileScope } from '../useProfileScope';
import { getEvents } from '../../api/events';
import { getSession } from '../../services/sessions';
import { queryKeys } from '../../lib/query/query-keys';
import { formatForServerInTz } from '../../lib/time';
import { asProfileId } from '../../api/types';
import type { EventData, EventsResponse } from '../../api/types';

vi.mock('../../api/events', () => ({
  getEvents: vi.fn(),
}));

vi.mock('../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(),
  // stores/profile.ts (pulled in transitively via lib/time.ts's
  // useProfileStore import) calls registerSessionsGate at module scope;
  // dropSession/dropAllSessions are its other named imports from this
  // module. Stubbed so that module-level wiring doesn't throw here.
  registerSessionsGate: vi.fn(),
  dropSession: vi.fn(),
  dropAllSessions: vi.fn(),
}));

vi.mock('../useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));

// Spy on the real useQueries (delegates to actual react-query) so the
// polling-opt-in tests can inspect exactly what query config the hook
// builds, without needing fake timers to prove a refetch never fires.
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  // Plain `(options: unknown) => unknown` shape, not `vi.fn(actual.useQueries)`
  // directly - useQueries' real signature is an overloaded generic that vi.fn's
  // own generic inference can't reconcile with itself (tsc error, no runtime
  // issue). The cast inside just forwards to the real implementation.
  const useQueriesSpy = vi.fn((options: unknown) => (actual.useQueries as (o: unknown) => unknown)(options));
  return { ...actual, useQueries: useQueriesSpy };
});

const profileA = {
  id: asProfileId('profile-a'),
  name: 'Home',
  apiUrl: 'http://a/api',
  portalUrl: 'http://a',
  cgiUrl: 'http://a/cgi-bin',
  isDefault: true,
  createdAt: 0,
  timezone: 'UTC',
};

const profileB = {
  id: asProfileId('profile-b'),
  name: 'Work',
  apiUrl: 'http://b/api',
  portalUrl: 'http://b',
  cgiUrl: 'http://b/cgi-bin',
  isDefault: false,
  createdAt: 0,
  timezone: 'America/New_York',
};

function event(id: string, startDateTime: string): EventData {
  return { Event: { Id: id, StartDateTime: startDateTime } } as EventData;
}

function eventsResponse(events: EventData[]): EventsResponse {
  return {
    events,
    pagination: {
      page: 1,
      pageCount: 1,
      current: 1,
      count: events.length,
      prevPage: false,
      nextPage: false,
      limit: 100,
      totalCount: events.length,
    },
  } as EventsResponse;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockScope(profiles: Array<typeof profileA>, mode: 'single' | 'all' = profiles.length === 1 ? 'single' : 'all') {
  const scope =
    mode === 'single'
      ? { mode: 'single' as const, profile: profiles[0], profiles: [profiles[0]] as [typeof profileA], settings: {} }
      : { mode: 'all' as const, profile: null, profiles, settings: {} };
  vi.mocked(useProfileScope).mockReturnValue(scope as unknown as ProfileScope);
}

function sessionFor(p: typeof profileA) {
  return {
    profileId: p.id,
    client: { profile: p.id } as unknown as import('../../api/client').ApiClient,
    timezone: p.timezone,
  };
}

const baseOptions = {
  filters: {},
  limit: 100,
  monitorId: undefined,
  isGroupFilterActive: false,
  eventIds: undefined,
  tagIds: undefined,
};

describe('useScopedEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockImplementation((id) => {
      const p = [profileA, profileB].find((pr) => pr.id === id);
      return sessionFor(p ?? profileA);
    });
  });

  it('orders merged events by true cross-timezone instant, not by wall-clock string', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      // A (UTC) at 14:00 vs B (America/New_York, EST=-05:00) at 10:00 the
      // same day: B's 10:00 EST = 15:00 UTC, so B is the LATER event even
      // though its wall-clock hour reads earlier.
      return isA
        ? eventsResponse([event('a1', '2026-01-15 14:00:00')])
        : eventsResponse([event('b1', '2026-01-15 10:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.events).toHaveLength(2));

    expect(result.current.events.map((e) => e.item.Event.Id)).toEqual(['b1', 'a1']);
  });

  it('keeps colliding event ids distinct across profiles, tagged with the owning profile', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return eventsResponse([event('1', isA ? '2026-01-15 09:00:00' : '2026-01-15 08:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.events).toHaveLength(2));

    const [first, second] = result.current.events;
    expect(first.item.Event.Id).toBe(second.item.Event.Id);
    expect(first.profileId).not.toBe(second.profileId);
    expect(new Set(result.current.events.map((e) => e.profileId)).size).toBe(2);
    expect(result.current.events.find((e) => e.profileId === profileA.id)?.profileName).toBe('Home');
    expect(result.current.events.find((e) => e.profileId === profileB.id)?.profileName).toBe('Work');
  });

  it('sums every profile\'s own totalCount, matching the single query\'s totalCount in single mode (refs #337)', async () => {
    mockScope([profileA], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00'), event('2', '2026-01-15 08:00:00')]));

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totalCount).toBe(2));
  });

  it('sums totalCount across profiles in All mode', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      return isA
        ? eventsResponse([event('a1', '2026-01-15 09:00:00')])
        : eventsResponse([event('b1', '2026-01-15 08:00:00'), event('b2', '2026-01-15 07:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.events).toHaveLength(3));
    expect(result.current.totalCount).toBe(3);
  });

  it('converts a shared date-range bound per profile using that profile\'s OWN timezone, not one shared value (refs #337)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    // A raw local datetime-local input string, as useEventFilters produces -
    // NOT pre-formatted server text (that conversion now happens per profile
    // inside the hook, not once up front by the caller).
    const filters = { startDateTime: '2026-01-15T10:00:00' };

    renderHook(() => useScopedEvents({ ...baseOptions, filters }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: typeof profileA) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { startDateTime?: string };

    const forA = callFor(profileA)?.startDateTime;
    const forB = callFor(profileB)?.startDateTime;
    expect(forA).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(forB).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // profileA=UTC and profileB=America/New_York (EST=-05:00) render the SAME
    // instant 5 hours apart on the wall clock - not the same shared string,
    // which is what the old caller-pre-converts-once behavior produced.
    expect(forA).not.toBe(forB);
    const hourOf = (s: string) => Number(s!.slice(11, 13));
    expect((hourOf(forA!) - hourOf(forB!) + 24) % 24).toBe(5);
  });

  // refs #337 fix round 1: a profile with no configured timezone must
  // convert date-range filters using the BROWSER zone (formatForServer's
  // historical fallback for the single-mode query this hook replaced), not
  // a hardcoded 'UTC' - the latter silently shifted the query window for
  // such a profile once Events.tsx switched to this hook.
  it('a profile without a timezone converts date filters using the browser zone, matching formatForServer byte-for-byte', async () => {
    const profileNoTz = { ...profileA, timezone: undefined as unknown as string };
    mockScope([profileNoTz], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    const filters = { startDateTime: '2026-01-15T10:00:00' };
    renderHook(() => useScopedEvents({ ...baseOptions, filters }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(1));

    const sent = vi.mocked(getEvents).mock.calls[0][2] as { startDateTime?: string };
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(sent.startDateTime).toBe(formatForServerInTz(new Date(filters.startDateTime), browserTz));
  });

  it('fans out only each profile\'s own composite monitorId selection (refs #337 I6)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(
      () => useScopedEvents({ ...baseOptions, monitorId: `${profileA.id}:3` }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: typeof profileA) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { monitorId?: string };

    // A's selection stays A's - B never gets filtered by a monitor id that
    // only means something on A's server.
    expect(callFor(profileA)?.monitorId).toBe('3');
    expect(callFor(profileB)?.monitorId).toBeUndefined();
  });

  it('joins multiple composite ids owned by the same profile into one comma list (refs #337 I6)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([]));

    renderHook(
      () => useScopedEvents({ ...baseOptions, monitorId: `${profileA.id}:3,${profileA.id}:5,${profileB.id}:7` }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    const callFor = (p: typeof profileA) =>
      vi.mocked(getEvents).mock.calls.find(([, id]) => id === p.id)?.[2] as { monitorId?: string };

    expect(callFor(profileA)?.monitorId).toBe('3,5');
    expect(callFor(profileB)?.monitorId).toBe('7');
  });

  it('surfaces one failing profile as a ProfileError while the other profile still renders its data', async () => {
    mockScope([profileA, profileB]);
    const failure = new Error('B is down');
    vi.mocked(getEvents).mockImplementation(async (client) => {
      const isA = (client as unknown as { profile: string }).profile === profileA.id;
      if (!isA) throw failure;
      return eventsResponse([event('1', '2026-01-15 09:00:00')]);
    });

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.errors).toHaveLength(1));

    expect(result.current.errors[0].profileId).toBe(profileB.id);
    expect(result.current.errors[0].profileName).toBe('Work');
    expect(result.current.errors[0].error).toBe(failure);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].profileId).toBe(profileA.id);
    expect(result.current.isLoading).toBe(false);
  });

  it('single-mode profile scope writes to the exact key Events.tsx reads, so the cache entry is shared', async () => {
    mockScope([profileA], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('42', '2026-01-15 09:00:00')]));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    // getEvents called with this profile's session client and id - the same
    // call Events.tsx makes for the current profile.
    expect(vi.mocked(getEvents).mock.calls[0][1]).toBe(profileA.id);

    // Cache entry lives at queryKeys.eventsList(id, ...) with the SAME args
    // Events.tsx passes - a single-mode surface using that key reads this
    // same data without a second network round trip.
    const key = queryKeys.eventsList(
      profileA.id,
      baseOptions.filters,
      baseOptions.limit,
      baseOptions.monitorId,
      baseOptions.isGroupFilterActive,
      baseOptions.eventIds,
      baseOptions.tagIds
    );
    expect(queryClient.getQueryData(key)).toEqual(eventsResponse([event('42', '2026-01-15 09:00:00')]));
  });

  it('refetchProfile(id) refetches only that profile', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    const { result } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    const callsBefore = vi.mocked(getEvents).mock.calls.length;
    result.current.refetchProfile(profileB.id);

    await waitFor(() => expect(vi.mocked(getEvents).mock.calls.length).toBeGreaterThan(callsBefore));
    const refetchCallClient = vi.mocked(getEvents).mock.calls[vi.mocked(getEvents).mock.calls.length - 1][0];
    expect((refetchCallClient as unknown as { profile: string }).profile).toBe(profileB.id);
  });

  it('keeps events/errors array identity across an unrelated rerender (combine + replaceEqualDeep)', async () => {
    mockScope([profileA], 'single');
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    const { result, rerender } = renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    const eventsRef = result.current.events;
    const errorsRef = result.current.errors;

    rerender();

    expect(result.current.events).toBe(eventsRef);
    expect(result.current.errors).toBe(errorsRef);
  });

  it('fetches every profile in scope even when neither has ever authenticated this session (refs #337)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => {
      const calledProfileIds = vi.mocked(getEvents).mock.calls.map(([, id]) => id);
      expect(calledProfileIds).toContain(profileB.id);
    });
  });

  it('does not poll by default - refetchInterval is omitted unless the caller opts in', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    renderHook(() => useScopedEvents(baseOptions), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(useQueries).mock.calls.length).toBeGreaterThan(0));
    const { queries } = vi.mocked(useQueries).mock.calls[0][0] as { queries: Array<{ refetchInterval?: number }> };
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.refetchInterval === undefined)).toBe(true);
  });

  it('honors an explicit refetchInterval when the caller opts in, staggered per profile (W8)', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEvents).mockResolvedValue(eventsResponse([event('1', '2026-01-15 09:00:00')]));

    renderHook(() => useScopedEvents({ ...baseOptions, refetchInterval: 15000 }), { wrapper: createWrapper() });

    await waitFor(() => expect(vi.mocked(useQueries).mock.calls.length).toBeGreaterThan(0));
    const { queries } = vi.mocked(useQueries).mock.calls[0][0] as { queries: Array<{ refetchInterval?: number }> };
    expect(queries).toHaveLength(2);
    // Index 0 keeps the base period exactly; index 1 gets a distinct,
    // bounded-larger period (stagger-interval.ts) so both profiles' polls
    // don't land as a synchronized burst.
    expect(queries[0].refetchInterval).toBe(15000);
    expect(queries[1].refetchInterval).toBeGreaterThan(15000);
    expect(queries[1].refetchInterval).toBeLessThanOrEqual(15000 * 1.5);
  });
});
