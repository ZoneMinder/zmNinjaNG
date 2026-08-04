import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useScopedAlarmStates } from '../useAlarmStates';
import { getAlarmStatus } from '../../api/monitors';
import { getSession } from '../../services/sessions';
import type { ProfileId } from '../../api/types';

vi.mock('../../api/monitors', () => ({ getAlarmStatus: vi.fn() }));
vi.mock('../../services/sessions', () => ({ getSession: vi.fn((profileId: string) => ({ client: { profileId } })) }));
// useAlarmStates.ts (this hook's sibling in the same module) imports these
// for the single-mode hook; mocked here purely to stop their real module
// graph (stores/profile.ts -> services/sessions' registerSessionsGate) from
// loading against the partial sessions mock above. useScopedAlarmStates
// itself never reads either.
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: null, settings: {} }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthSlice: () => ({ isAuthenticated: true }),
}));

const mockStatus = vi.mocked(getAlarmStatus);
const mockGetSession = vi.mocked(getSession);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const p1 = 'p1' as ProfileId;
const p2 = 'p2' as ProfileId;

describe('useScopedAlarmStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fans out one request per pair via the OWNING profile session, keyed composite', async () => {
    mockStatus.mockImplementation(async (client: unknown, id: string) => {
      const c = client as { profileId: string };
      return c.profileId === 'p1' && id === '3' ? { status: 2 } : { status: 0 };
    });

    const { result } = renderHook(
      () =>
        useScopedAlarmStates(
          [
            { profileId: p1, monitorId: '3' },
            { profileId: p2, monitorId: '3' },
          ],
          { enabled: true, pollIntervalMs: 5000 }
        ),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states).toEqual({ 'p1:3': 'alarm', 'p2:3': 'idle' });
    });
    // Two servers sharing raw monitor id "3" must not collide in the map,
    // and each pair's OWN profile's session client must have been used.
    expect(mockGetSession).toHaveBeenCalledWith('p1');
    expect(mockGetSession).toHaveBeenCalledWith('p2');
  });

  it('emits a total map: every requested pair present, disabled means empty', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useScopedAlarmStates([{ profileId: p1, monitorId: '3' }], { enabled, pollIntervalMs: 5000 }),
      { wrapper, initialProps: { enabled: false } }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.states).toEqual({});
    expect(mockStatus).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => {
      expect(result.current.states).toEqual({ 'p1:3': 'idle' });
    });
  });

  it('holds a pair at its last known state when a poll fails', async () => {
    let shouldFail = false;
    mockStatus.mockImplementation(async () => {
      if (shouldFail) throw new Error('boom');
      return { status: 2 };
    });

    const { result } = renderHook(
      () => useScopedAlarmStates([{ profileId: p1, monitorId: '3' }], { enabled: true, pollIntervalMs: 20 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['p1:3']).toBe('alarm');
    });

    shouldFail = true;
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.states['p1:3']).toBe('alarm');
  });

  it('returns the same states object across renders while nothing changes', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    const { result, rerender } = renderHook(
      () => useScopedAlarmStates([{ profileId: p1, monitorId: '3' }], { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['p1:3']).toBe('idle');
    });

    const settledStates = result.current.states;
    rerender();
    rerender();

    expect(result.current.states).toBe(settledStates);
  });
});
