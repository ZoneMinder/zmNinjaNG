import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileService } from '../profile';

// Mock secure storage
vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn(),
  getSecureValue: vi.fn(),
  removeSecureValue: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    profile: vi.fn(),
    profileService: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

import { setSecureValue, getSecureValue, removeSecureValue } from '../../lib/security/secureStorage';

describe('ProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('savePassword', () => {
    it('should save password to secure storage', async () => {
      vi.mocked(setSecureValue).mockResolvedValue(undefined);

      await ProfileService.savePassword('profile-123', 'my-secure-password');

      expect(setSecureValue).toHaveBeenCalledWith('password_profile-123', 'my-secure-password');
    });

    it('should throw error if storage fails', async () => {
      vi.mocked(setSecureValue).mockRejectedValue(new Error('Storage error'));

      await expect(ProfileService.savePassword('profile-123', 'password')).rejects.toThrow(
        'Failed to securely store password'
      );
    });
  });

  describe('getPassword', () => {
    it('should retrieve password from secure storage', async () => {
      vi.mocked(getSecureValue).mockResolvedValue('retrieved-password');

      const password = await ProfileService.getPassword('profile-123');

      expect(getSecureValue).toHaveBeenCalledWith('password_profile-123');
      expect(password).toBe('retrieved-password');
    });

    it('should return undefined if password not found', async () => {
      vi.mocked(getSecureValue).mockResolvedValue(null);

      const password = await ProfileService.getPassword('profile-123');

      expect(password).toBeUndefined();
    });

    it('should return undefined and log error on storage failure', async () => {
      vi.mocked(getSecureValue).mockRejectedValue(new Error('Storage error'));

      const password = await ProfileService.getPassword('profile-123');

      expect(password).toBeUndefined();
    });
  });

  describe('deletePassword', () => {
    it('should remove password from secure storage', async () => {
      vi.mocked(removeSecureValue).mockResolvedValue(undefined);

      await ProfileService.deletePassword('profile-123');

      expect(removeSecureValue).toHaveBeenCalledWith('password_profile-123');
    });

    it('should not throw error if removal fails', async () => {
      vi.mocked(removeSecureValue).mockRejectedValue(new Error('Storage error'));

      await expect(ProfileService.deletePassword('profile-123')).resolves.toBeUndefined();
    });
  });
});
