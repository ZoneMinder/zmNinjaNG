import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkDeleteEvents } from '../useBulkDeleteEvents';
import { deleteEvent } from '../../api/events';
import { getSession } from '../../services/sessions';
import { eventSelectionKey } from '../../stores/deleteSelection';
import { asProfileId } from '../../api/types';
import { toast } from 'sonner';

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

vi.mock('../../api/events', () => ({ deleteEvent: vi.fn() }));
vi.mock('../../services/sessions', () => ({
  // Mirrors the real registry: a real profile id yields its own client, the
  // ALL sentinel throws (services/sessions.ts getSession).
  getSession: vi.fn((id: string) => {
    if (id === 'ALL') throw new Error('getSession: ALL_PROFILES_ID has no session');
    return { client: { profileId: id } };
  }),
  // All mode makes the ALL sentinel the current profile, so the real
  // getCurrentSession throws there - the crash this suite guards against.
  getCurrentSession: vi.fn(() => {
    if (!mockCurrentProfile) throw new Error('getSession: ALL_PROFILES_ID has no session');
    return { client: { profileId: 'p1' } };
  }),
  registerSessionsGate: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { count?: number }) => `${k}:${o?.count ?? ''}` }) }));
vi.mock('../../lib/logger', () => ({ log: { eventCard: vi.fn() }, LogLevel: { ERROR: 'ERROR' } }));

// All mode leaves currentProfile null (useCurrentProfile: the ALL sentinel
// matches no real profile); single mode resolves a real one.
let mockCurrentProfile: { id: string } | null = { id: 'p1' };
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: mockCurrentProfile, settings: {}, hasProfile: !!mockCurrentProfile, isAllMode: !mockCurrentProfile }),
}));

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  mockCurrentProfile = { id: 'p1' };
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
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed:');
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

    expect(asMock(getSession).mock.calls.map((c) => c[0])).toEqual(['p2']);
    expect(deleteEvent).toHaveBeenCalledWith({ profileId: 'p2' }, '9');
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
  beforeEach(() => { mockCurrentProfile = null; });

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

    expect(asMock(getSession).mock.calls.map((c) => c[0]).sort()).toEqual(['p1', 'p2']);
    expect(deleteEvent).toHaveBeenCalledWith({ profileId: 'p1' }, '1234');
    expect(deleteEvent).toHaveBeenCalledWith({ profileId: 'p2' }, '77');
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
    asMock(deleteEvent).mockImplementation((client: { profileId: string }) =>
      client.profileId === 'p2' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined));
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    let deleted: string[] = [];
    await act(async () => {
      deleted = await result.current.deleteEvents([
        eventSelectionKey(P1, '1'),
        eventSelectionKey(P2, '2'),
      ]);
    });

    expect(deleted).toEqual([eventSelectionKey(P1, '1')]);
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed:');
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
      deleted = await result.current.deleteEvents([eventSelectionKey(asProfileId('ALL'), '9')]);
    });

    expect(deleted).toEqual([]);
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed:');
  });
});
