import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDeleteEvent } from '../useDeleteEvent';
import { deleteEvent } from '../../api/events';
import { toast } from 'sonner';

vi.mock('../../api/events', () => ({ deleteEvent: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../lib/logger', () => ({
  log: { eventCard: vi.fn() },
  LogLevel: { ERROR: 'ERROR' },
}));

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

describe('useDeleteEvent', () => {
  it('deletes, invalidates events/event/monitorRecentEvents, and toasts success', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });

    await act(async () => { await result.current.deleteEvent('42'); });

    expect(deleteEvent).toHaveBeenCalledWith('42');
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('"events"'))).toBe(true);
    expect(keys.some((k) => k.includes('"event"') && k.includes('42'))).toBe(true);
    // the monitorRecentEvents invalidation uses a predicate (no queryKey field)
    expect(spy.mock.calls.some((c) => typeof (c[0] as { predicate?: unknown })?.predicate === 'function')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('events.delete_success');
  });

  it('toasts failure when the API rejects', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });
    await act(async () => { await result.current.deleteEvent('42'); });
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed');
  });

  it('predicate matches a monitorRecentEvents query key', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });
    await act(async () => { await result.current.deleteEvent('42'); });
    const predCall = spy.mock.calls.find((c) => typeof (c[0] as { predicate?: unknown })?.predicate === 'function');
    const predicate = (predCall![0] as unknown as { predicate: (q: { queryKey: unknown[] }) => boolean }).predicate;
    expect(predicate({ queryKey: ['p1', 'monitorRecentEvents', '3', 5] })).toBe(true);
    expect(predicate({ queryKey: ['monitors'] })).toBe(false);
  });
});
