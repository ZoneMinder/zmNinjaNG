import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useScopedEventTagMapping, useScopedTags } from '../useScopedEventTags';
import { useProfileScope, type ProfileScope } from '../useProfileScope';
import { getTags, getEventTags, extractUniqueTags } from '../../api/tags';
import { getSession } from '../../services/sessions';
import { queryKeys } from '../../lib/query/query-keys';
import { asProfileId } from '../../api/types';
import type { Tag } from '../../api/types';

vi.mock('../../api/tags', () => ({
  getTags: vi.fn(),
  getEventTags: vi.fn(),
  extractUniqueTags: vi.fn(),
}));

vi.mock('../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock('../useProfileScope', () => ({
  useProfileScope: vi.fn(),
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

function tag(id: string, name: string): Tag {
  return { Id: id, Name: name } as Tag;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe('useScopedEventTagMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: { profile: id } as unknown as import('../../api/client').ApiClient,
      timezone: 'UTC',
    }));
  });

  it('attributes a colliding event id to the profile that owns it', async () => {
    mockScope([profileA, profileB]);
    // Both servers have an event 100. Each fetch must only ever answer for
    // its own profile's ids.
    vi.mocked(getEventTags).mockImplementation(async (client) => {
      const owner = (client as unknown as { profile: string }).profile;
      return owner === profileA.id
        ? new Map([['100', [tag('1', 'person')]]])
        : new Map([['100', [tag('9', 'vehicle')]]]);
    });

    const { result } = renderHook(
      () =>
        useScopedEventTagMapping({
          events: [
            { profileId: profileA.id, eventId: '100' },
            { profileId: profileB.id, eventId: '100' },
          ],
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.eventTagMap.size).toBe(2));
    expect(result.current.getTagsForEvent(profileA.id, '100').map((t) => t.Name)).toEqual(['person']);
    expect(result.current.getTagsForEvent(profileB.id, '100').map((t) => t.Name)).toEqual(['vehicle']);
  });

  it('asks each profile only for the event ids it owns', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEventTags).mockResolvedValue(new Map());

    renderHook(
      () =>
        useScopedEventTagMapping({
          events: [
            { profileId: profileA.id, eventId: '5' },
            { profileId: profileA.id, eventId: '4' },
            { profileId: profileB.id, eventId: '77' },
          ],
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(vi.mocked(getEventTags).mock.calls.length).toBe(2));
    const byProfile = new Map(
      vi.mocked(getEventTags).mock.calls.map(([client, ids]) => [(client as unknown as { profile: string }).profile, ids])
    );
    // Sorted, so the cache key is stable across reorderings of the same set.
    expect(byProfile.get(profileA.id)).toEqual(['4', '5']);
    expect(byProfile.get(profileB.id)).toEqual(['77']);
  });

  it('single mode keys the map by the bare event id and reads the shared cache slot', async () => {
    mockScope([profileA], 'single');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    };
    vi.mocked(getEventTags).mockResolvedValue(new Map([['100', [tag('1', 'person')]]]));

    const { result } = renderHook(
      () => useScopedEventTagMapping({ events: [{ profileId: profileA.id, eventId: '100' }] }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.eventTagMap.size).toBe(1));
    // Single-mode rows carry no profileId, so their lookups stay bare-keyed.
    expect(result.current.eventTagMap.get('100')?.map((t) => t.Name)).toEqual(['person']);
    // Same key the single-profile useEventTagMapping writes, so the two share
    // one cache entry instead of double-fetching.
    expect(queryClient.getQueryData(queryKeys.eventTags(profileA.id, ['100']))).toBeDefined();
  });

  it('one profile failing still yields the other profile tags', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEventTags).mockImplementation(async (client) => {
      const owner = (client as unknown as { profile: string }).profile;
      if (owner === profileA.id) throw new Error('server down');
      return new Map([['77', [tag('9', 'vehicle')]]]);
    });

    const { result } = renderHook(
      () =>
        useScopedEventTagMapping({
          events: [
            { profileId: profileA.id, eventId: '100' },
            { profileId: profileB.id, eventId: '77' },
          ],
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.getTagsForEvent(profileB.id, '77')).toHaveLength(1));
    expect(result.current.getTagsForEvent(profileA.id, '100')).toEqual([]);
  });

  // combine's output is what QueriesObserver deep-diffs, and it only reuses
  // references for plain arrays/objects - a Map comes back brand new every
  // render. Events.tsx keys its allEvents useMemo on this map, so a churning
  // identity remints every row object and defeats memo(EventItem) for every
  // card on every render.
  it('keeps eventTagMap identity across a rerender with unchanged data', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEventTags).mockResolvedValue(new Map([['100', [tag('1', 'person')]]]));
    const events = [{ profileId: profileA.id, eventId: '100' }];

    const { result, rerender } = renderHook(() => useScopedEventTagMapping({ events }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.eventTagMap.size).toBe(1));

    const firstMap = result.current.eventTagMap;
    const firstLookup = result.current.getTagsForEvent;
    rerender();

    expect(result.current.eventTagMap).toBe(firstMap);
    expect(result.current.getTagsForEvent).toBe(firstLookup);
  });

  it('enabled:false fetches nothing', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getEventTags).mockResolvedValue(new Map());

    const { result } = renderHook(
      () => useScopedEventTagMapping({ events: [{ profileId: profileA.id, eventId: '1' }], enabled: false }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.eventTagMap.size).toBe(0));
    expect(vi.mocked(getEventTags)).not.toHaveBeenCalled();
  });
});

describe('useScopedTags', () => {
  // The two servers agree on "person" and disagree on everything else,
  // including which numeric id "person" carries - the case that makes ids
  // useless as a cross-server filter token.
  const tagsA = [tag('1', 'person'), tag('2', 'cat')];
  const tagsB = [tag('7', 'person'), tag('8', 'vehicle')];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: { profile: id } as unknown as import('../../api/client').ApiClient,
      timezone: 'UTC',
    }));
    // The real extractUniqueTags dedupes the API's tag-per-event rows; the
    // fetch mock below already returns a flat list, so pass it through.
    vi.mocked(extractUniqueTags).mockImplementation(
      (response) => (response as unknown as { flat: Tag[] }).flat
    );
    vi.mocked(getTags).mockImplementation(async (client) => {
      const owner = (client as unknown as { profile: string }).profile;
      return { flat: owner === profileA.id ? tagsA : tagsB } as never;
    });
  });

  it('offers each shared tag name once across servers', async () => {
    mockScope([profileA, profileB]);

    const { result } = renderHook(() => useScopedTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.availableTags.length).toBe(3));
    expect(result.current.availableTags.map((t) => t.Name)).toEqual(['person', 'cat', 'vehicle']);
    // The name is the aggregate token, so a selection means the same thing on
    // every server rather than pointing at whatever id happens to match.
    expect(result.current.availableTags.map((t) => t.Id)).toEqual(['person', 'cat', 'vehicle']);
    expect(result.current.tagsSupported).toBe(true);
  });

  it('resolves a selected name to each server own id for that name', async () => {
    mockScope([profileA, profileB]);

    const { result } = renderHook(() => useScopedTags(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.availableTags.length).toBe(3));

    expect(result.current.resolveOwnTagIds(['person'], profileA.id)).toEqual(['1']);
    expect(result.current.resolveOwnTagIds(['person'], profileB.id)).toEqual(['7']);
  });

  it('resolves to nothing on a server that lacks the selected tag', async () => {
    mockScope([profileA, profileB]);

    const { result } = renderHook(() => useScopedTags(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.availableTags.length).toBe(3));

    // "cat" only exists on profile A. Profile B must match no events at all,
    // NOT fall back to an unfiltered query.
    expect(result.current.resolveOwnTagIds(['cat'], profileA.id)).toEqual(['2']);
    expect(result.current.resolveOwnTagIds(['cat'], profileB.id)).toEqual([]);
  });

  it('single mode offers that profile own tags and passes its ids through untouched', async () => {
    mockScope([profileA], 'single');

    const { result } = renderHook(() => useScopedTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.availableTags.length).toBe(2));
    expect(result.current.availableTags.map((t) => t.Id)).toEqual(['1', '2']);
    expect(result.current.resolveOwnTagIds(['1'], profileA.id)).toEqual(['1']);
  });

  it('keeps availableTags and the resolver stable across a rerender', async () => {
    mockScope([profileA, profileB]);

    const { result, rerender } = renderHook(() => useScopedTags(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.availableTags.length).toBe(3));

    const firstTags = result.current.availableTags;
    const firstResolver = result.current.resolveOwnTagIds;
    rerender();

    expect(result.current.availableTags).toBe(firstTags);
    // Events.tsx builds tagIdsByProfile in a useMemo keyed on this - a new
    // identity every render remints the filter and rekeys every events query.
    expect(result.current.resolveOwnTagIds).toBe(firstResolver);
  });

  it('reports tags unsupported when no profile answers the endpoint', async () => {
    mockScope([profileA, profileB]);
    vi.mocked(getTags).mockResolvedValue(null);

    const { result } = renderHook(() => useScopedTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoadingTags).toBe(false));
    expect(result.current.tagsSupported).toBe(false);
    expect(result.current.availableTags).toEqual([]);
  });
});
