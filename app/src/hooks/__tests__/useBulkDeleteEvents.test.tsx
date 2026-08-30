import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../api/events', () => ({ deleteEvent: vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Every interpolated value is appended, so a toast that drops one is visible
// in the assertion instead of reading as the bare key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => `${k}:${o ? Object.values(o).join(':') : ''}`,
  }),
}));

import { useBulkDeleteEvents } from '../useBulkDeleteEvents';
import { deleteEvent } from '../../api/events';
import { eventSelectionKey } from '../../stores/deleteSelection';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';
import { toast } from 'sonner';
import { createHttpError } from '../../lib/http/types';
import { usePermissionDenialStore, denialKey } from '../../stores/permissions';
import { seedProfiles, resetProfileFixture, fakeApiClient, type FakeApiClient } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

let qc: QueryClient;
// Each profile gets its OWN client instance, so a delete that lands on the
// wrong profile's session is a client identity the test can catch.
let clientP1: FakeApiClient;
let clientP2: FakeApiClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  seedProfiles([P1, P2], { current: P1 });
  clientP1 = fakeApiClient();
  clientP2 = fakeApiClient();
  installApiClient(P1, clientP1);
  installApiClient(P2, clientP2);
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('useBulkDeleteEvents - single mode', () => {
  it('deletes all ids, invalidates, and toasts success with the count', async () => {
    asMock(deleteEvent).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    await act(async () => { await result.current.deleteEvents(['1', '2']); });

    expect(deleteEvent).toHaveBeenCalledTimes(2);
    expect(deleteEvent).toHaveBeenCalledWith(expect.anything(), '1');
    expect(deleteEvent).toHaveBeenCalledWith(expect.anything(), '2');
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('"events"'))).toBe(true);
    expect(spy.mock.calls.some((c) => typeof (c[0] as { predicate?: unknown })?.predicate === 'function')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('events.delete_selected_success:2');
  });

  it('toasts failure when any delete rejects, without aborting the rest', async () => {
    asMock(deleteEvent)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1', '2']); });
    expect(deleteEvent).toHaveBeenCalledTimes(2); // both attempted
    // One landed, one did not, and the toast has to say so: "Delete failed"
    // alone reads as "nothing was deleted", which would send the user back to
    // re-delete an event the server no longer has.
    expect(toast.error).toHaveBeenCalledWith('events.delete_partial:1:1');
  });

  it('does nothing for an empty list', async () => {
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents([]); });
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('honours the key\'s own profile over the current one', async () => {
    // A key that names its owner wins even when a real current profile is
    // available to fall back on - otherwise a deep /all/ route open in single
    // mode would delete against the wrong server.
    asMock(deleteEvent).mockResolvedValue(undefined);
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    await act(async () => { await result.current.deleteEvents([eventSelectionKey(P2, '9')]); });

    // clientP2 (P2's OWN installed client), not clientP1 (the current
    // profile's), proves the key's own profile won over the current one.
    expect(deleteEvent).toHaveBeenCalledWith(clientP2, '9');
  });

  it('removes the deleted events from a cached events list immediately', async () => {
    asMock(deleteEvent).mockResolvedValue(undefined);
    qc.setQueryData(['events', P1], {
      events: [{ Event: { Id: '1' } }, { Event: { Id: '2' } }],
      pagination: {},
    });
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1']); });
    const cached = qc.getQueryData(['events', P1]) as { events: { Event: { Id: string } }[] };
    expect(cached.events.map((e) => e.Event.Id)).toEqual(['2']);
  });
});

describe('useBulkDeleteEvents - All mode', () => {
  beforeEach(() => {
    // The ALL sentinel as current profile: useCurrentProfile resolves no
    // real profile for it (isAggregateProfileId), so currentProfile is null,
    // matching what selecting All Servers actually leaves in the real store.
    seedProfiles([P1, P2], { current: ALL_PROFILES_ID });
  });

  it('routes each event to its OWN profile session instead of the ALL sentinel', async () => {
    asMock(deleteEvent).mockResolvedValue(undefined);
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    let deleted: string[] = [];
    await act(async () => {
      deleted = await result.current.deleteEvents([
        eventSelectionKey(P1, '1234'),
        eventSelectionKey(P2, '77'),
      ]);
    });

    expect(deleteEvent).toHaveBeenCalledWith(clientP1, '1234');
    expect(deleteEvent).toHaveBeenCalledWith(clientP2, '77');
    expect(deleted.sort()).toEqual([eventSelectionKey(P1, '1234'), eventSelectionKey(P2, '77')].sort());
    expect(toast.success).toHaveBeenCalledWith('events.delete_selected_success:2');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('strips a deleted event only from the OWNING profile cached list', async () => {
    asMock(deleteEvent).mockResolvedValue(undefined);
    // Same raw ZM id 1234 exists on both servers - deleting profile 1's must
    // not evict profile 2's identically numbered event.
    qc.setQueryData(['events', P1], { events: [{ Event: { Id: '1234' } }], pagination: {} });
    qc.setQueryData(['events', P2], { events: [{ Event: { Id: '1234' } }], pagination: {} });

    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents([eventSelectionKey(P1, '1234')]); });

    expect((qc.getQueryData(['events', P1]) as { events: unknown[] }).events).toEqual([]);
    expect((qc.getQueryData(['events', P2]) as { events: { Event: { Id: string } }[] }).events
      .map((e) => e.Event.Id)).toEqual(['1234']);
  });

  it('keeps the failed profile selected and reports the failure on partial success', async () => {
    asMock(deleteEvent).mockImplementation((client: unknown) =>
      client === clientP2 ? Promise.reject(new Error('boom')) : Promise.resolve(undefined));
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    let deleted: string[] = [];
    await act(async () => {
      deleted = await result.current.deleteEvents([
        eventSelectionKey(P1, '1'),
        eventSelectionKey(P2, '2'),
      ]);
    });

    expect(deleted).toEqual([eventSelectionKey(P1, '1')]);
    expect(toast.error).toHaveBeenCalledWith('events.delete_partial:1:1');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('invalidates only the owning profile\'s monitorRecentEvents queries', async () => {
    asMock(deleteEvent).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    qc.setQueryData(['monitorRecentEvents', P1, '4', 10], { events: [] });
    qc.setQueryData(['monitorRecentEvents', P2, '4', 10], { events: [] });

    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents([eventSelectionKey(P1, '1234')]); });

    const predicates = spy.mock.calls
      .map((c) => (c[0] as { predicate?: (q: { queryKey: readonly unknown[] }) => boolean }).predicate)
      .filter((p): p is (q: { queryKey: readonly unknown[] }) => boolean => typeof p === 'function');
    expect(predicates.length).toBeGreaterThan(0);
    expect(predicates.some((p) => p({ queryKey: ['monitorRecentEvents', P1, '4', 10] }))).toBe(true);
    expect(predicates.every((p) => !p({ queryKey: ['monitorRecentEvents', P2, '4', 10] }))).toBe(true);
  });

  it('still reports the delete when the cache update afterwards throws', async () => {
    // The server already removed the events. A cache failure must not unsay
    // that: reporting none deleted leaves them queued and every retry 404s.
    asMock(deleteEvent).mockResolvedValue(undefined);
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => { throw new Error('cache exploded'); });

    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    let deleted: string[] = [];
    await act(async () => {
      deleted = await result.current.deleteEvents([eventSelectionKey(P1, '1234')]);
    });

    expect(deleted).toEqual([eventSelectionKey(P1, '1234')]);
    expect(toast.success).toHaveBeenCalledWith('events.delete_selected_success:1');
  });

  it('reports a failure instead of rejecting when a profile has no session', async () => {
    asMock(deleteEvent).mockResolvedValue(undefined);
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    let deleted: string[] = [];
    await act(async () => {
      deleted = await result.current.deleteEvents([eventSelectionKey(ALL_PROFILES_ID, '9')]);
    });

    expect(deleted).toEqual([]);
    expect(deleteEvent).not.toHaveBeenCalled();
    // Nothing survived, so there is no count worth reporting.
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed:');
  });
});

/**
 * A refused delete has to be told apart from a failed one (refs #344).
 *
 * allSettled only counts, so before this the 401 that means "your account may
 * not" and the timeout that means "try again" produced the same sentence, and
 * the user could queue the same events forever.
 */
describe('useBulkDeleteEvents when ZoneMinder refuses', () => {
  const privilegeRefusal = createHttpError(
    401,
    'Unauthorized',
    { success: false, data: { name: 'Insufficient Privileges' } },
    {},
  );

  beforeEach(() => {
    usePermissionDenialStore.setState({ denied: {} });
  });

  it('names the permission rather than reporting a generic failure', async () => {
    vi.mocked(deleteEvent).mockRejectedValue(privilegeRefusal);

    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1']); });

    expect(toast.error).toHaveBeenCalledWith('events.delete_permission_denied:');
  });

  it('latches the profile so the controls grey afterwards', async () => {
    vi.mocked(deleteEvent).mockRejectedValue(privilegeRefusal);

    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1']); });

    expect(usePermissionDenialStore.getState().denied[denialKey(P1, 'events-edit')]).toBe(true);
  });

  it('leaves the generic message and no latch for an ordinary failure', async () => {
    vi.mocked(deleteEvent).mockRejectedValue(new Error('Failed to fetch'));

    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1']); });

    expect(toast.error).toHaveBeenCalledWith('events.delete_failed:');
    expect(usePermissionDenialStore.getState().denied).toEqual({});
  });
});
