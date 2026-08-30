import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import {
  bootstrapAuth,
  bootstrapTimezone,
  bootstrapZmsPath,
  bootstrapGo2RTCPath,
  bootstrapMultiPortStreaming,
  performBootstrap,
  type BootstrapContext,
} from '../../services/profile-bootstrap';
import type { Profile } from '../../api/types';
import { asProfileId } from '../../api/types';
import { useAuthStore } from '../auth';
import { useSettingsStore } from '../settings';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    profileService: vi.fn(),
    auth: vi.fn(),
    sslTrust: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

// Mock API imports
vi.mock('../../api/time', () => ({
  getServerTimeZone: vi.fn(),
}));

vi.mock('../../api/auth', () => ({
  fetchZmsPath: vi.fn(),
  fetchGo2RTCPath: vi.fn(),
}));

vi.mock('../../api/server', () => ({
  fetchMinStreamingPort: vi.fn(),
  // getSession's fire-and-forget server-map bootstrap (services/sessions.ts)
  // calls this on every session it creates; unstubbed it's undefined and
  // getSession throws before bootstrapTimezone/ZmsPath/etc even run.
  getServers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));

describe('Profile Bootstrap', () => {
  let mockContext: BootstrapContext;
  let mockProfile: Profile;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      getDecryptedPassword: vi.fn().mockResolvedValue('decrypted-password'),
      updateProfile: vi.fn().mockResolvedValue(undefined),
    };

    mockProfile = {
      id: asProfileId('test-profile'),
      name: 'Test Profile',
      portalUrl: 'https://zm.example.com',
      apiUrl: 'https://zm.example.com/api',
      cgiUrl: 'https://zm.example.com/cgi-bin',
      isDefault: true,
      createdAt: Date.now(),
      username: 'admin',
      password: 'stored-securely',
    };

    // getSession(profile.id) needs the real sessions gate (registered by
    // stores/profile.ts, pulled in transitively by profile-fixture) to find
    // a profile; the client it returns is never actually used, since every
    // api/* call it's passed to is mocked below.
    seedProfiles([mockProfile]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  describe('bootstrapAuth', () => {
    it('skips authentication when no credentials are stored and marks as authenticated', async () => {
      const setTokensSpy = vi.spyOn(useAuthStore.getState(), 'setTokens');
      const profileWithoutCreds = { ...mockProfile, username: undefined, password: undefined };

      await bootstrapAuth(profileWithoutCreds, mockContext);

      expect(mockContext.getDecryptedPassword).not.toHaveBeenCalled();
      expect(setTokensSpy).toHaveBeenCalledWith(mockProfile.id, {});
      expect(useAuthStore.getState().slices[mockProfile.id]?.isAuthenticated).toBe(true);
      expect(useAuthStore.getState().slices[mockProfile.id]?.requiresAuth).toBe(false);
    });

    it('authenticates with stored credentials', async () => {
      // login itself (the actual server round-trip) is covered by
      // auth.test.ts; stubbing it here isolates what bootstrapAuth is
      // responsible for - decrypting the stored password and calling login
      // with the right arguments.
      const loginSpy = vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue(undefined);

      await bootstrapAuth(mockProfile, mockContext);

      expect(mockContext.getDecryptedPassword).toHaveBeenCalledWith('test-profile');
      expect(loginSpy).toHaveBeenCalledWith(mockProfile.id, 'admin', 'decrypted-password');
    });

    it('handles password decryption failure gracefully', async () => {
      vi.mocked(mockContext.getDecryptedPassword).mockResolvedValue(undefined);

      // Should not throw
      await bootstrapAuth(mockProfile, mockContext);

      // Auth should not proceed without decrypted password
    });

    it('handles authentication failure gracefully', async () => {
      vi.spyOn(useAuthStore.getState(), 'login').mockRejectedValue(new Error('Auth failed'));

      // Should not throw
      await bootstrapAuth(mockProfile, mockContext);
    });
  });

  describe('bootstrapTimezone', () => {
    it('fetches and updates timezone when different', async () => {
      const { getServerTimeZone } = await import('../../api/time');
      vi.mocked(getServerTimeZone).mockResolvedValue('America/New_York');

      await bootstrapTimezone(mockProfile, mockContext);

      expect(getServerTimeZone).toHaveBeenCalled();
      expect(mockContext.updateProfile).toHaveBeenCalledWith('test-profile', {
        timezone: 'America/New_York',
      });
    });

    it('does not update when timezone matches', async () => {
      const { getServerTimeZone } = await import('../../api/time');
      vi.mocked(getServerTimeZone).mockResolvedValue('UTC');
      const profileWithTimezone = { ...mockProfile, timezone: 'UTC' };

      await bootstrapTimezone(profileWithTimezone, mockContext);

      expect(mockContext.updateProfile).not.toHaveBeenCalled();
    });

    it('handles timezone fetch failure gracefully', async () => {
      const { getServerTimeZone } = await import('../../api/time');
      vi.mocked(getServerTimeZone).mockRejectedValue(new Error('Network error'));

      // Should not throw
      await bootstrapTimezone(mockProfile, mockContext);
      expect(mockContext.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('bootstrapZmsPath', () => {
    it('updates CGI URL when ZMS path is available', async () => {
      const { fetchZmsPath } = await import('../../api/auth');
      vi.mocked(fetchZmsPath).mockResolvedValue('/zm/cgi-bin/nph-zms');

      await bootstrapZmsPath(mockProfile, mockContext);

      expect(mockContext.updateProfile).toHaveBeenCalledWith('test-profile', {
        cgiUrl: 'https://zm.example.com/zm/cgi-bin/nph-zms',
      });
    });

    it('does not update when ZMS path is not available', async () => {
      const { fetchZmsPath } = await import('../../api/auth');
      vi.mocked(fetchZmsPath).mockResolvedValue(null);

      await bootstrapZmsPath(mockProfile, mockContext);

      expect(mockContext.updateProfile).not.toHaveBeenCalled();
    });

    it('does not update when CGI URL already matches', async () => {
      const { fetchZmsPath } = await import('../../api/auth');
      vi.mocked(fetchZmsPath).mockResolvedValue('/cgi-bin');
      const profileWithMatchingCgi = {
        ...mockProfile,
        cgiUrl: 'https://zm.example.com/cgi-bin',
      };

      await bootstrapZmsPath(profileWithMatchingCgi, mockContext);

      expect(mockContext.updateProfile).not.toHaveBeenCalled();
    });

    it('handles fetch failure gracefully', async () => {
      const { fetchZmsPath } = await import('../../api/auth');
      vi.mocked(fetchZmsPath).mockRejectedValue(new Error('Network error'));

      // Should not throw
      await bootstrapZmsPath(mockProfile, mockContext);
    });
  });

  describe('bootstrapGo2RTCPath', () => {
    it('updates go2rtcUrl when available', async () => {
      const { fetchGo2RTCPath } = await import('../../api/auth');
      vi.mocked(fetchGo2RTCPath).mockResolvedValue('ws://localhost:1984/api/ws');

      await bootstrapGo2RTCPath(mockProfile, mockContext);

      expect(mockContext.updateProfile).toHaveBeenCalledWith('test-profile', {
        go2rtcUrl: 'ws://localhost:1984/api/ws',
      });
    });

    it('clears go2rtcUrl when not configured', async () => {
      const { fetchGo2RTCPath } = await import('../../api/auth');
      vi.mocked(fetchGo2RTCPath).mockResolvedValue(null);
      const profileWithGo2rtc = { ...mockProfile, go2rtcUrl: 'ws://old-url' };

      await bootstrapGo2RTCPath(profileWithGo2rtc, mockContext);

      expect(mockContext.updateProfile).toHaveBeenCalledWith('test-profile', {
        go2rtcUrl: undefined,
      });
    });

    it('does not update when go2rtcUrl matches', async () => {
      const { fetchGo2RTCPath } = await import('../../api/auth');
      vi.mocked(fetchGo2RTCPath).mockResolvedValue('ws://localhost:1984/api/ws');
      const profileWithGo2rtc = { ...mockProfile, go2rtcUrl: 'ws://localhost:1984/api/ws' };

      await bootstrapGo2RTCPath(profileWithGo2rtc, mockContext);

      expect(mockContext.updateProfile).not.toHaveBeenCalled();
    });

    it('handles fetch failure gracefully', async () => {
      const { fetchGo2RTCPath } = await import('../../api/auth');
      vi.mocked(fetchGo2RTCPath).mockRejectedValue(new Error('Not found'));

      // Should not throw
      await bootstrapGo2RTCPath(mockProfile, mockContext);
    });
  });

  describe('bootstrapMultiPortStreaming', () => {
    it('updates minStreamingPort when configured', async () => {
      const { fetchMinStreamingPort } = await import('../../api/server');
      vi.mocked(fetchMinStreamingPort).mockResolvedValue(31000);

      await bootstrapMultiPortStreaming(mockProfile, mockContext);

      expect(mockContext.updateProfile).toHaveBeenCalledWith('test-profile', {
        minStreamingPort: 31000,
      });
    });

    it('does not update when multi-port is not configured', async () => {
      const { fetchMinStreamingPort } = await import('../../api/server');
      vi.mocked(fetchMinStreamingPort).mockResolvedValue(null);

      await bootstrapMultiPortStreaming(mockProfile, mockContext);

      expect(mockContext.updateProfile).not.toHaveBeenCalled();
    });

    it('handles fetch failure gracefully', async () => {
      const { fetchMinStreamingPort } = await import('../../api/server');
      vi.mocked(fetchMinStreamingPort).mockRejectedValue(new Error('Network error'));

      // Should not throw
      await bootstrapMultiPortStreaming(mockProfile, mockContext);
    });

    it('logs the force-disabled override when the profile setting is on', async () => {
      const { fetchMinStreamingPort } = await import('../../api/server');
      vi.mocked(fetchMinStreamingPort).mockResolvedValue(31000);
      useSettingsStore.getState().updateProfileSettings('test-profile', { forceDisableMultiPort: true });
      const { log } = await import('../../lib/logger');

      await bootstrapMultiPortStreaming(mockProfile, mockContext);

      expect(log.profileService).toHaveBeenCalledWith(
        'Multi-port streaming available on server, force-disabled by profile setting',
        expect.anything(),
        { minPort: 31000 },
      );
      expect(log.profileService).not.toHaveBeenCalledWith(
        'Multi-port streaming enabled',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('performBootstrap', () => {
    it('runs all bootstrap steps in sequence', async () => {
      const { getServerTimeZone } = await import('../../api/time');
      const { fetchZmsPath, fetchGo2RTCPath } = await import('../../api/auth');
      const { fetchMinStreamingPort } = await import('../../api/server');

      vi.mocked(getServerTimeZone).mockResolvedValue('UTC');
      vi.mocked(fetchZmsPath).mockResolvedValue('/cgi-bin');
      vi.mocked(fetchGo2RTCPath).mockResolvedValue(null);
      vi.mocked(fetchMinStreamingPort).mockResolvedValue(null);
      vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue(undefined);

      await performBootstrap(mockProfile, mockContext);

      // Verify all steps were called
      expect(mockContext.getDecryptedPassword).toHaveBeenCalled();
      expect(getServerTimeZone).toHaveBeenCalled();
      expect(fetchZmsPath).toHaveBeenCalled();
      expect(fetchGo2RTCPath).toHaveBeenCalled();
      expect(fetchMinStreamingPort).toHaveBeenCalled();
    });
  });
});
