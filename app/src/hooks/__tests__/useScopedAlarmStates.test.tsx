import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../api/monitors', () => ({ getAlarmStatus: vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useScopedAlarmStates } from '../useAlarmStates';
import { getAlarmStatus } from '../../api/monitors';
import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

const mockStatus = vi.mocked(getAlarmStatus);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const p1 = asProfileId('p1');
const p2 = asProfileId('p2');

describe('useScopedAlarmStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles([p1, p2]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fans out one request per pair via the OWNING profile session, keyed composite', async () => {
    // Each profile gets its OWN client instance installed, so a poll landing
    // on the wrong profile's session is a client the test can catch, not one
    // that happens to look the same.
    const clientP1 = fakeApiClient();
    const clientP2 = fakeApiClient();
    installApiClient(p1, clientP1);
    installApiClient(p2, clientP2);
    mockStatus.mockImplementation(async (client: unknown, id: string) =>
      client === clientP1 && id === '3' ? { status: 2 } : { status: 0 }
    );

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

    // Two servers sharing raw monitor id "3" must not collide in the map,
    // and each pair's OWN profile's session client must have been used - the
    // states map itself proves it, since the implementation above only
    // reports "alarm" for clientP1's own request.
    await waitFor(() => {
      expect(result.current.states).toEqual({ 'p1:3': 'alarm', 'p2:3': 'idle' });
    });
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
