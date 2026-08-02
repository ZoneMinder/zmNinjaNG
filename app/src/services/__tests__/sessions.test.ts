import { describe, it, expect, beforeEach, vi } from 'vitest';
import { asProfileId, type Profile, type ProfileId } from '../../api/types';
import {
  registerSessionsGate,
  getSession,
  getCurrentSession,
  hasSession,
  dropSession,
  dropAllSessions,
  ALL_PROFILES_ID,
} from '../sessions';

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn((baseURL: string, _reLogin?: () => Promise<boolean>, profileId?: string) => ({
    __tag: `client:${profileId}:${baseURL}`,
  })),
  resetAuthGates: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    profileService: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

import { createStoreApiClient } from '../../api/store-gates';

const aId = asProfileId('profile-a');
const bId = asProfileId('profile-b');

function makeProfile(id: ProfileId, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: id,
    portalUrl: 'https://portal.example',
    apiUrl: `https://api.example/${id}`,
    cgiUrl: 'https://cgi.example',
    isDefault: false,
    createdAt: 0,
    ...overrides,
  };
}

describe('sessions', () => {
  const profiles = new Map<ProfileId, Profile>([
    [aId, makeProfile(aId, { timezone: 'America/New_York' })],
    [bId, makeProfile(bId, { timezone: 'Europe/London' })],
  ]);
  let currentProfileId: ProfileId | null = aId;

  beforeEach(() => {
    vi.clearAllMocks();
    dropAllSessions();
    currentProfileId = aId;
    registerSessionsGate({
      getProfile: (id) => profiles.get(id),
      getCurrentProfileId: () => currentProfileId,
      reLoginFor: (id) => async () => {
        void id;
        return true;
      },
    });
  });

  it('lazily creates one session per profile and caches it', () => {
    const s1 = getSession(aId);
    const s2 = getSession(aId);

    expect(s1).toBe(s2);
    expect(getSession(bId)).not.toBe(s1);
    expect(s1.timezone).toBe('America/New_York');
  });

  it('builds the client via createStoreApiClient with the profile apiUrl and id', () => {
    getSession(aId);

    expect(createStoreApiClient).toHaveBeenCalledWith(
      'https://api.example/profile-a',
      expect.any(Function),
      aId,
    );
  });

  it('defaults timezone to UTC when the profile has none', () => {
    profiles.set(bId, makeProfile(bId, { timezone: undefined }));

    const session = getSession(bId);

    expect(session.timezone).toBe('UTC');
  });

  it('throws for ALL_PROFILES_ID and unknown ids', () => {
    expect(() => getSession(ALL_PROFILES_ID)).toThrow();
    expect(() => getSession(asProfileId('nope'))).toThrow();
  });

  it('dropSession evicts so the next get rebuilds', () => {
    const s1 = getSession(aId);
    dropSession(aId);

    expect(hasSession(aId)).toBe(false);
    expect(getSession(aId)).not.toBe(s1);
  });

  it('getCurrentSession returns the session for the current profile', () => {
    currentProfileId = bId;

    const session = getCurrentSession();

    expect(session.profileId).toBe(bId);
  });

  it('getCurrentSession throws when there is no current profile', () => {
    currentProfileId = null;

    expect(() => getCurrentSession()).toThrow();
  });
});
