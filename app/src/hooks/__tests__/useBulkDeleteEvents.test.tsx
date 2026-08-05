import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkDeleteEvents } from '../useBulkDeleteEvents';
import { deleteEvent } from '../../api/events';
import { toast } from 'sonner';

vi.mock('../../api/events', () => ({ deleteEvent: vi.fn() }));
vi.mock('../../services/sessions', () => ({
  getCurrentSession: vi.fn(() => ({ client: {} })),
  registerSessionsGate: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { count?: number }) => `${k}:${o?.count ?? ''}` }) }));
vi.mock('../../lib/logger', () => ({ log: { eventCard: vi.fn() }, LogLevel: { ERROR: 'ERROR' } }));

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

describe('useBulkDeleteEvents', () => {
  it('deletes all ids, invalidates, and toasts success with the count', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
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
    (deleteEvent as unknown as ReturnType<typeof vi.fn>)
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

  it('removes the deleted events from a cached events list immediately', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    qc.setQueryData(['events', 'x'], {
      events: [{ Event: { Id: '1' } }, { Event: { Id: '2' } }],
      pagination: {},
    });
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1']); });
    const cached = qc.getQueryData(['events', 'x']) as { events: { Event: { Id: string } }[] };
    expect(cached.events.map((e) => e.Event.Id)).toEqual(['2']);
  });
});
