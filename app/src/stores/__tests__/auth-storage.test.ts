/**
 * Tests for the auth persistence adapter (encryptedAuthStorage).
 *
 * Verifies the refresh token is kept out of the localStorage blob and routed
 * through secureStorage, that a legacy in-blob token migrates, and that an
 * encryption failure drops the token instead of writing plaintext.
 *
 * Platform.isNative is false in the test env (src/tests/setup.ts), so
 * secureStorage uses the web AES-GCM path with the real Web Crypto API.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageValue } from 'zustand/middleware';

vi.mock('../../api/auth', () => ({ login: vi.fn(), refreshToken: vi.fn() }));
vi.mock('../../api/client-ready', () => ({
  isApiClientInitialized: () => true,
  setApiClientInitialized: vi.fn(),
}));
// Mock the logger to a no-op. This also severs the auth -> logger ->
// log-sanitizer -> profile -> auth import cycle during module init.
vi.mock('../../lib/logger', () => ({
  log: new Proxy({}, { get: () => vi.fn() }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));
vi.mock('../../lib/crypto', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/crypto')>();
  return { ...actual, isCryptoAvailable: vi.fn(() => true) };
});

import { encryptedAuthStorage } from '../auth';
import { encrypt, isCryptoAvailable } from '../../lib/crypto';
import { getSecureValue, clearSecureStorage } from '../../lib/secureStorage';

const NAME = 'zmng-auth';
const SECURE_KEY = 'auth_refresh_token';

function blob(refreshToken: string | null): StorageValue<{
  refreshToken: string | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
  requiresAuth: boolean;
}> {
  return {
    state: {
      refreshToken,
      refreshTokenExpires: 123,
      version: '1.0',
      apiVersion: '2.0',
      requiresAuth: true,
    },
    version: 0,
  };
}

describe('encryptedAuthStorage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearSecureStorage();
    vi.mocked(isCryptoAvailable).mockReturnValue(true);
  });

  it('keeps the refresh token out of the localStorage blob and round-trips it', async () => {
    await encryptedAuthStorage.setItem(NAME, blob('refresh-abc'));

    const rawBlob = localStorage.getItem(NAME)!;
    expect(rawBlob).not.toContain('refresh-abc');
    expect(JSON.parse(rawBlob).state.refreshToken).toBeNull();
    expect(await getSecureValue(SECURE_KEY)).toBe('refresh-abc');

    const loaded = await encryptedAuthStorage.getItem(NAME);
    expect(loaded?.state.refreshToken).toBe('refresh-abc');
  });

  it('migrates a legacy in-blob encrypted refresh token into secure storage', async () => {
    const legacyEncrypted = await encrypt('legacy-token');
    localStorage.setItem(NAME, JSON.stringify(blob(legacyEncrypted)));

    const loaded = await encryptedAuthStorage.getItem(NAME);
    expect(loaded?.state.refreshToken).toBe('legacy-token');
    expect(await getSecureValue(SECURE_KEY)).toBe('legacy-token');
  });

  it('drops the token instead of writing plaintext when secure storage is unavailable', async () => {
    vi.mocked(isCryptoAvailable).mockReturnValue(false);
    await encryptedAuthStorage.setItem(NAME, blob('should-not-persist'));

    const rawBlob = localStorage.getItem(NAME)!;
    expect(rawBlob).not.toContain('should-not-persist');
    expect(JSON.parse(rawBlob).state.refreshToken).toBeNull();

    vi.mocked(isCryptoAvailable).mockReturnValue(true);
    const loaded = await encryptedAuthStorage.getItem(NAME);
    expect(loaded?.state.refreshToken).toBeNull();
  });

  it('clears the secure token on removeItem', async () => {
    await encryptedAuthStorage.setItem(NAME, blob('tok'));
    expect(await getSecureValue(SECURE_KEY)).toBe('tok');

    await encryptedAuthStorage.removeItem(NAME);
    expect(localStorage.getItem(NAME)).toBeNull();
    expect(await getSecureValue(SECURE_KEY)).toBeNull();
  });
});
