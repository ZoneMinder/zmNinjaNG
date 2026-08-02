/**
 * Tests for the auth persistence adapter (encryptedAuthStorage).
 *
 * Verifies refresh tokens are kept out of the localStorage blob and routed
 * through secureStorage as one JSON map keyed by profile id, that an
 * encryption failure drops the tokens instead of writing plaintext, that
 * removeItem clears the token map, and that a legacy (pre-per-profile)
 * persisted blob is discarded rather than converted.
 *
 * Platform.isNative is false in the test env (src/tests/setup.ts), so
 * secureStorage uses the web AES-GCM path with the real Web Crypto API.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageValue } from 'zustand/middleware';

vi.mock('../../api/auth', () => ({ login: vi.fn(), refreshToken: vi.fn() }));
// Mock the logger to a no-op. This also severs the auth -> logger ->
// log-sanitizer -> profile -> auth import cycle during module init.
vi.mock('../../lib/logger', () => ({
  log: new Proxy({}, { get: () => vi.fn() }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));
vi.mock('../../lib/security/crypto', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/security/crypto')>();
  return { ...actual, isCryptoAvailable: vi.fn(() => true) };
});

import { encryptedAuthStorage } from '../auth';
import { isCryptoAvailable } from '../../lib/security/crypto';
import { getSecureValue, clearSecureStorage } from '../../lib/security/secureStorage';
import { asProfileId } from '../../api/types';

const NAME = 'zmng-auth';
const SECURE_KEY = 'auth_refresh_token';
const aId = asProfileId('a');
const bId = asProfileId('b');

interface PersistedSlice {
  refreshToken: string | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
  requiresAuth: boolean;
}

function slice(refreshToken: string | null): PersistedSlice {
  return { refreshToken, refreshTokenExpires: 123, version: '1.0', apiVersion: '2.0', requiresAuth: true };
}

function blob(slices: Record<string, PersistedSlice>): StorageValue<{ slices: Record<string, PersistedSlice> }> {
  return { state: { slices }, version: 0 };
}

describe('encryptedAuthStorage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearSecureStorage();
    vi.mocked(isCryptoAvailable).mockReturnValue(true);
  });

  it('keeps refresh tokens out of the localStorage blob and round-trips them per profile', async () => {
    await encryptedAuthStorage.setItem(NAME, blob({ [aId]: slice('refresh-abc'), [bId]: slice('refresh-def') }));

    const rawBlob = localStorage.getItem(NAME)!;
    expect(rawBlob).not.toContain('refresh-abc');
    expect(rawBlob).not.toContain('refresh-def');
    expect(JSON.parse(rawBlob).state.slices.a.refreshToken).toBeNull();
    expect(JSON.parse(rawBlob).state.slices.b.refreshToken).toBeNull();

    const stored = await getSecureValue(SECURE_KEY);
    expect(JSON.parse(stored!)).toEqual({ a: 'refresh-abc', b: 'refresh-def' });

    const loaded = await encryptedAuthStorage.getItem(NAME);
    expect(loaded?.state.slices[aId].refreshToken).toBe('refresh-abc');
    expect(loaded?.state.slices[bId].refreshToken).toBe('refresh-def');
  });

  it('drops tokens instead of writing plaintext when secure storage is unavailable', async () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(false);
    await encryptedAuthStorage.setItem(NAME, blob({ [aId]: slice('should-not-persist') }));

    const rawBlob = localStorage.getItem(NAME)!;
    expect(rawBlob).not.toContain('should-not-persist');
    expect(JSON.parse(rawBlob).state.slices.a.refreshToken).toBeNull();

    vi.mocked(isCryptoAvailable).mockReturnValue(true);
    const loaded = await encryptedAuthStorage.getItem(NAME);
    expect(loaded?.state.slices[aId].refreshToken).toBeNull();
  });

  it('clears the secure token map on removeItem', async () => {
    await encryptedAuthStorage.setItem(NAME, blob({ [aId]: slice('tok') }));
    expect(await getSecureValue(SECURE_KEY)).not.toBeNull();

    await encryptedAuthStorage.removeItem(NAME);
    expect(localStorage.getItem(NAME)).toBeNull();
    expect(await getSecureValue(SECURE_KEY)).toBeNull();
  });

  it('discards a legacy pre-per-profile persisted blob rather than converting it', async () => {
    // Old shape: refreshToken lived at the top of `state`, not nested per profile.
    localStorage.setItem(NAME, JSON.stringify({
      state: { refreshToken: null, refreshTokenExpires: 123, version: '1.0', apiVersion: '2.0', requiresAuth: true },
      version: 0,
    }));

    const loaded = await encryptedAuthStorage.getItem(NAME);
    expect(loaded).toBeNull();
  });
});
