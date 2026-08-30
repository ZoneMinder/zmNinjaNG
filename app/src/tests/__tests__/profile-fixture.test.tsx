/**
 * The fixture is itself under test: if seeding stops reaching the real
 * stores, or the session registry stops handing out the installed client,
 * every migrated test would silently pass against nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../fake-secure-storage'));

import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId } from '../profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../fake-store-gates';
import { getSession, getCurrentSession } from '../../services/sessions';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { useAuthStore } from '../../stores/auth';

describe('profile fixture', () => {
  beforeEach(() => seedProfiles(['home', 'shed'], { current: 'home', settings: { home: { streamMaxFps: 7 } } }));
  afterEach(() => { resetProfileFixture(); resetFakeStoreGates(); });

  it('the real session registry hands out the installed fake client', async () => {
    const client = fakeApiClient({ '/monitors.json': { monitors: [{ Monitor: { Id: '1', Name: 'Door' } }] } });
    installApiClient(asProfileId('shed'), client);

    const res = await getSession(asProfileId('shed')).client.get<{ monitors: unknown[] }>('/monitors.json');
    expect(res.data.monitors).toHaveLength(1);
    // The real registry also populates the server map on session creation;
    // that request landing here proves the session is real, not a stub.
    expect(client.calls.map((c) => c.url)).toEqual(['/servers.json', '/monitors.json']);
  });

  it('an unscripted request rejects rather than passing on nothing', async () => {
    installApiClient(asProfileId('home'), fakeApiClient());
    await expect(getSession(asProfileId('home')).client.get('/events.json')).rejects.toThrow(/no route/);
  });

  it('the real hooks see the seeded state, including merged settings', () => {
    const { result } = renderHook(() => useCurrentProfile());
    expect(result.current.currentProfile?.name).toBe('home');
    expect(result.current.settings.streamMaxFps).toBe(7);
    expect(getCurrentSession().profileId).toBe('home');

    const scope = renderHook(() => useProfileScope()).result.current;
    expect(scope?.profiles.map((p) => p.id)).toEqual(['home']);
  });

  it('seeded profiles are authenticated, and reset clears everything', () => {
    expect(useAuthStore.getState().slices[asProfileId('home')]?.accessToken).toBe('access-home');
    expect(useAuthStore.getState().slices[asProfileId('home')]?.isAuthenticated).toBe(true);
    resetProfileFixture();
    expect(useAuthStore.getState().slices[asProfileId('home')]?.accessToken ?? null).toBeNull();
    const { result } = renderHook(() => useCurrentProfile());
    expect(result.current.currentProfile).toBeNull();
    expect(() => getCurrentSession()).toThrow(/no current profile/);
  });
});
