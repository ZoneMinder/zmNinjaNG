import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(null),
  hasSecureValue: vi.fn().mockResolvedValue(false),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

import { hashPin, verifyPin, storePin, hasPinStored, clearPin } from '../kioskPin';
import { setSecureValue, getSecureValue, hasSecureValue, removeSecureValue } from '../security/secureStorage';

describe('kioskPin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hashPin', () => {
    it('returns a hex string for a 4-digit pin', async () => {
      const result = await hashPin('1234', 'testsalt');
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns different hashes for different pins', async () => {
      const hash1 = await hashPin('1234', 'salt');
      const hash2 = await hashPin('5678', 'salt');
      expect(hash1).not.toBe(hash2);
    });

    it('returns different hashes for different salts', async () => {
      const hash1 = await hashPin('1234', 'salt1');
      const hash2 = await hashPin('1234', 'salt2');
      expect(hash1).not.toBe(hash2);
    });

    it('returns the same hash for the same pin and salt', async () => {
      const hash1 = await hashPin('1234', 'mysalt');
      const hash2 = await hashPin('1234', 'mysalt');
      expect(hash1).toBe(hash2);
    });
  });

  describe('storePin and verifyPin', () => {
    it('stores a pin hash and salt in secure storage', async () => {
      await storePin('1234');
      expect(setSecureValue).toHaveBeenCalledTimes(2);
      expect(setSecureValue).toHaveBeenCalledWith('kiosk_pin_hash', expect.any(String));
      expect(setSecureValue).toHaveBeenCalledWith('kiosk_pin_salt', expect.any(String));
    });

    it('verifies a correct pin', async () => {
      let storedHash = '';
      let storedSalt = '';
      vi.mocked(setSecureValue).mockImplementation(async (key, value) => {
        if (key === 'kiosk_pin_hash') storedHash = value;
        if (key === 'kiosk_pin_salt') storedSalt = value;
      });
      vi.mocked(getSecureValue).mockImplementation(async (key) => {
        if (key === 'kiosk_pin_hash') return storedHash;
        if (key === 'kiosk_pin_salt') return storedSalt;
        return null;
      });

      await storePin('9876');
      const result = await verifyPin('9876');
      expect(result).toBe(true);
    });

    it('rejects an incorrect pin', async () => {
      let storedHash = '';
      let storedSalt = '';
      vi.mocked(setSecureValue).mockImplementation(async (key, value) => {
        if (key === 'kiosk_pin_hash') storedHash = value;
        if (key === 'kiosk_pin_salt') storedSalt = value;
      });
      vi.mocked(getSecureValue).mockImplementation(async (key) => {
        if (key === 'kiosk_pin_hash') return storedHash;
        if (key === 'kiosk_pin_salt') return storedSalt;
        return null;
      });

      await storePin('9876');
      const result = await verifyPin('0000');
      expect(result).toBe(false);
    });
  });

  describe('hasPinStored', () => {
    it('returns false when no pin is stored', async () => {
      vi.mocked(hasSecureValue).mockResolvedValue(false);
      expect(await hasPinStored()).toBe(false);
    });

    it('returns true when a pin is stored', async () => {
      vi.mocked(hasSecureValue).mockResolvedValue(true);
      expect(await hasPinStored()).toBe(true);
    });
  });

  describe('clearPin', () => {
    it('removes pin hash and salt from secure storage', async () => {
      await clearPin();
      expect(removeSecureValue).toHaveBeenCalledWith('kiosk_pin_hash');
      expect(removeSecureValue).toHaveBeenCalledWith('kiosk_pin_salt');
    });
  });
});
