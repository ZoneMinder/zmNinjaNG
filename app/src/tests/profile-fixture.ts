/**
 * Seed the REAL profile, settings and auth stores for a test.
 *
 * The testing playbook says: test against the real store, mock only `api/*`.
 * A third of the suite did the opposite, faking `useCurrentProfile`,
 * `useProfileScope`, `stores/profile` and `services/sessions` per file, so a
 * test passed against whatever its mock said rather than what the app does,
 * and the failure mode that matters most for a Zustand subscription (a
 * selector minting a fresh object, looping through useSyncExternalStore) was
 * invisible to it. This is the one shared way to do it properly.
 *
 *   vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
 *   vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));
 *
 *   beforeEach(() => seedProfiles(['home', 'shed'], { current: 'home' }));
 *   afterEach(resetProfileFixture);
 *
 * Both mocks are one-liners because vi.mock is hoisted and cannot be called
 * from inside a helper.
 */
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, mergeProfileSettings, type ProfileSettings } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { dropAllSessions } from '../services/sessions';
import { asProfileId, type Profile, type ProfileId } from '../api/types';
export { fakeApiClient, fakeResponse, type FakeApiClient } from './fake-api-client';

export function makeProfile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id: asProfileId(id),
    name: overrides.name ?? id,
    portalUrl: `http://${id}.test`,
    apiUrl: `http://${id}.test/api`,
    cgiUrl: `http://${id}.test/cgi-bin`,
    isDefault: false,
    createdAt: 1,
    timezone: 'UTC',
    ...overrides,
  };
}

export interface SeedOptions {
  /** Which profile is current; default the first. `null` for none. */
  current?: string | null;
  /** Per-profile settings overrides, merged over DEFAULT_SETTINGS. */
  settings?: Record<string, Partial<ProfileSettings>>;
  /** Mark each profile authenticated with a live token. Default true. */
  authenticated?: boolean;
}

/** Seed the real stores. Accepts ids or full Profile objects. */
export function seedProfiles(profiles: Array<string | Profile>, opts: SeedOptions = {}): Profile[] {
  const list = profiles.map((p) => (typeof p === 'string' ? makeProfile(p) : p));
  const current = opts.current === undefined ? list[0]?.id ?? null : opts.current === null ? null : asProfileId(opts.current);

  useProfileStore.setState({
    profiles: list,
    virtualProfiles: [],
    currentProfileId: current,
    isInitialized: true,
  });

  const profileSettings: Record<string, ProfileSettings> = {};
  for (const p of list) profileSettings[p.id] = mergeProfileSettings(opts.settings?.[p.id] ?? {});
  useSettingsStore.setState({ profileSettings });

  if (opts.authenticated ?? true) {
    const auth = useAuthStore.getState();
    for (const p of list) {
      auth.setTokens(p.id, {
        access_token: `access-${p.id}`,
        access_token_expires: 3600,
        refresh_token: `refresh-${p.id}`,
        refresh_token_expires: 86400,
      });
    }
  }
  return list;
}

export function resetProfileFixture(): void {
  dropAllSessions();
  useAuthStore.getState().logoutAll();
  useProfileStore.setState({ profiles: [], virtualProfiles: [], currentProfileId: null, isInitialized: false });
  useSettingsStore.setState({ profileSettings: {} });
}

export { asProfileId };
export type { ProfileId };
