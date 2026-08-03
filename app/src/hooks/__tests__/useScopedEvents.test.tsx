import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useScopedEvents } from '../useScopedEvents';
import { useProfileScope, type ProfileScope } from '../useProfileScope';
import { useBandwidthSettings } from '../useBandwidthSettings';
import { getEvents } from '../../api/events';
import { getSession } from '../../services/sessions';
import { queryKeys } from '../../lib/query/query-keys';
import { asProfileId } from '../../api/types';
import type { EventData, EventsResponse } from '../../api/types';

vi.mock('../../api/events', () => ({
  getEvents: vi.fn(),
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
    vi.mocked(useBandwidthSettings).mockReturnValue({
      eventsWidgetInterval: 30000,
    } as never);
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
});
