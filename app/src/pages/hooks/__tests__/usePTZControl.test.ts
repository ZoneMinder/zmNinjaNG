/**
 * usePTZControl tests.
 *
 * Regression coverage for #337 (All mode deep routes): when the caller passes
 * an explicit profileId (an /all/monitors/:profileId/:id detail page), PTZ
 * commands must go out through THAT profile's client, not whichever profile
 * happens to be globally current.
 *
 * Runs against the real profile, settings and auth stores and the real
 * session registry; only the HTTP client is fake (tests/profile-fixture).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

vi.mock('../../../api/monitors', () => ({ controlMonitor: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { controlMonitor } from '../../../api/monitors';
import { usePTZControl } from '../usePTZControl';
import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

describe('usePTZControl profile scoping (refs #337)', () => {
  beforeEach(() => {
    vi.mocked(controlMonitor).mockClear();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it("sends the command via the given profile's client when profileId is provided", async () => {
    seedProfiles(['a', 'b'], { current: 'a' });
    const clientA = fakeApiClient({ '/servers.json': { servers: [] } });
    const clientB = fakeApiClient({ '/servers.json': { servers: [] } });
    installApiClient(asProfileId('a'), clientA);
    installApiClient(asProfileId('b'), clientB);

    const { result } = renderHook(() =>
      usePTZControl({
        portalUrl: 'https://portal.test',
        monitorId: 'mon-1',
        accessToken: 'tok',
        profileId: asProfileId('b'),
      })
    );

    await act(async () => {
      await result.current.handlePTZCommand('up');
    });

    // Asserting the exact client object proves the command reached profile
    // B's server, not the globally-current profile A's.
    expect(controlMonitor).toHaveBeenCalledWith(
      clientB,
      'https://portal.test',
      'mon-1',
      'up',
      'tok',
      undefined
    );
  });

  it('falls back to the current session when profileId is omitted (single mode, zero change)', async () => {
    seedProfiles(['a', 'b'], { current: 'a' });
    const clientA = fakeApiClient({ '/servers.json': { servers: [] } });
    const clientB = fakeApiClient({ '/servers.json': { servers: [] } });
    installApiClient(asProfileId('a'), clientA);
    installApiClient(asProfileId('b'), clientB);

    const { result } = renderHook(() =>
      usePTZControl({
        portalUrl: 'https://portal.test',
        monitorId: 'mon-1',
        accessToken: 'tok',
      })
    );

    await act(async () => {
      await result.current.handlePTZCommand('up');
    });

    expect(controlMonitor).toHaveBeenCalledWith(
      clientA,
      'https://portal.test',
      'mon-1',
      'up',
      'tok',
      undefined
    );
  });
});
