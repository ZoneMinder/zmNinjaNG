/**
 * MobilePushService tests.
 *
 * Covers token registration/deregistration lifecycle, platform gating, and
 * error paths. Store access is injected via setPushServiceStoreGates (refs
 * #217, the DI gate that broke stores/notifications <-> pushNotifications
 * import cycle), so tests supply fakes instead of mocking zustand stores
 * globally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import {
  MobilePushService,
  getPushService,
  resetPushService,
  setPushServiceStoreGates,
  type PushServiceStoreGates,
} from '../pushNotifications';
import type { NotificationSettings } from '../../stores/notifications';
import type { Profile } from '../../api/types';
import { asProfileId, ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';

// @capacitor-firebase/messaging is mocked globally in src/tests/setup.ts
// (not re-declared per-file here): pushNotifications.ts fires several
// overlapping `await import('@capacitor-firebase/messaging')` calls the
// first time initialize() runs (the outer call, _createNotificationChannel,
// the fire-and-forget _setupListeners, and the inner getToken() call all
// import it independently), and a per-file vi.mock factory raced one of
// those call sites into loading the real package instead of the mock.
const mockRequestPermissions = vi.mocked(FirebaseMessaging.requestPermissions);
const mockGetToken = vi.mocked(FirebaseMessaging.getToken);
const mockCreateChannel = vi.mocked(FirebaseMessaging.createChannel);
const mockAddListener = vi.mocked(FirebaseMessaging.addListener);
const mockRemoveAllListeners = vi.mocked(FirebaseMessaging.removeAllListeners);
const mockDeleteToken = vi.mocked(FirebaseMessaging.deleteToken);

const h = vi.hoisted(() => ({
  isNative: true,
  platform: 'android' as 'android' | 'ios',
}));

vi.mock('../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return h.isNative;
    },
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => h.platform,
  },
}));

const mockLogPush = vi.fn();
vi.mock('../../lib/logger', () => ({
  log: { push: (...args: unknown[]) => mockLogPush(...args) },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

const mockNavigateToEvent = vi.fn();
const mockNavigate = vi.fn();
vi.mock('../../lib/navigation', () => ({
  navigationService: {
    navigateToEvent: (...args: unknown[]) => mockNavigateToEvent(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
}));

const mockRegisterToken = vi.fn();
const mockDeleteNotification = vi.fn();
vi.mock('../../api/notifications', () => ({
  registerToken: (...args: unknown[]) => mockRegisterToken(...args),
  deleteNotification: (...args: unknown[]) => mockDeleteNotification(...args),
}));

vi.mock('../sessions', () => ({
  getSession: vi.fn(() => ({ client: {} })),
}));

const mockResolveProfileForNotification = vi.fn();
const mockRequestProfileSwitch = vi.fn();
vi.mock('../../lib/profile/notification-profile', () => ({
  resolveProfileForNotification: (...args: unknown[]) => mockResolveProfileForNotification(...args),
  requestProfileSwitch: (...args: unknown[]) => mockRequestProfileSwitch(...args),
}));

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDeregisterPushTokenOnService = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
vi.mock('../notifications', () => ({
  ZMNotificationService: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    deregisterPushToken: mockDeregisterPushTokenOnService,
    disconnect: mockDisconnect,
  })),
}));

function makeSettings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    enabled: true,
    notificationMode: 'es',
    notificationId: null,
    host: 'es.example.com',
    port: 9000,
    ssl: false,
    allMonitors: true,
    monitorFilters: [],
    onlyDetectedEvents: false,
    pollingInterval: 60,
    showToasts: true,
    playSound: true,
    badgeCount: 0,
    ...overrides,
  };
}

const PROFILE: Profile = {
  id: asProfileId('profile-1'),
  name: 'Home',
  portalUrl: 'https://zm.example.com',
  apiUrl: 'https://zm.example.com/api',
  cgiUrl: 'https://zm.example.com/cgi-bin',
  username: 'alice',
  isDefault: true,
  createdAt: Date.now(),
};

function makeFakeGates(overrides: Partial<PushServiceStoreGates> = {}): PushServiceStoreGates {
  return {
    notifications: {
      getCurrentProfileId: vi.fn().mockReturnValue('profile-1'),
      getProfileSettings: vi.fn().mockReturnValue(makeSettings()),
      isConnected: vi.fn().mockReturnValue(false),
      updateProfileSettings: vi.fn(),
      deregisterPushToken: vi.fn().mockResolvedValue(undefined),
      registerPushToken: vi.fn().mockResolvedValue(undefined),
      addEvent: vi.fn(),
      markEventRead: vi.fn(),
      ...overrides.notifications,
    },
    profile: {
      getProfiles: vi.fn().mockReturnValue([PROFILE]),
      getDecryptedPassword: vi.fn().mockResolvedValue('secret'),
      getCurrentProfileId: vi.fn().mockReturnValue('profile-1'),
      ...overrides.profile,
    },
    auth: {
      getAccessToken: vi.fn().mockReturnValue('token-abc'),
      ...overrides.auth,
    },
  };
}

let gates: PushServiceStoreGates;

beforeEach(() => {
  vi.clearAllMocks();
  h.isNative = true;
  h.platform = 'android';
  mockRequestPermissions.mockResolvedValue({ receive: 'granted' });
  mockGetToken.mockResolvedValue({ token: 'fcm-token-123' });
  gates = makeFakeGates();
  setPushServiceStoreGates(gates);
});

afterEach(() => {
  resetPushService();
  vi.useRealTimers();
});

describe('platform gating', () => {
  it('initialize() is a no-op on non-native platforms', async () => {
    h.isNative = false;
    const service = new MobilePushService();
    await service.initialize();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(service.getToken()).toBeNull();
    expect(service.isReady()).toBe(false);
  });

  it('deregister() is a no-op on non-native platforms', async () => {
    h.isNative = false;
    const service = new MobilePushService();
    await expect(service.deregister()).resolves.toBeUndefined();
    expect(mockRemoveAllListeners).not.toHaveBeenCalled();
  });
});

describe('initialize()', () => {
  it('does not request a token when permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ receive: 'denied' });
    const service = new MobilePushService();
    await service.initialize();

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(service.getToken()).toBeNull();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Push notification permission denied',
      expect.anything(),
      expect.objectContaining({ receive: 'denied' })
    );
  });

  it('creates the Android notification channel but not on iOS', async () => {
    h.platform = 'android';
    const androidService = new MobilePushService();
    await androidService.initialize();
    expect(mockCreateChannel).toHaveBeenCalledTimes(1);

    mockCreateChannel.mockClear();
    h.platform = 'ios';
    const iosService = new MobilePushService();
    await iosService.initialize();
    expect(mockCreateChannel).not.toHaveBeenCalled();
  });

  it('stores the FCM token and registers it with the server on success', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(true);
    const service = new MobilePushService();
    await service.initialize();

    expect(service.getToken()).toBe('fcm-token-123');
    expect(service.isReady()).toBe(true);
    expect(gates.notifications.registerPushToken).toHaveBeenCalledWith('fcm-token-123', 'android');
  });

  it('retries getToken() once after 5s when the first request fails, then succeeds', async () => {
    vi.useFakeTimers();
    mockGetToken.mockRejectedValueOnce(new Error('token unavailable')).mockResolvedValueOnce({ token: 'retry-token' });

    const service = new MobilePushService();
    const initPromise = service.initialize();
    await initPromise;

    expect(service.getToken()).toBeNull();
    expect(mockGetToken).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(mockGetToken).toHaveBeenCalledTimes(2);
    expect(service.getToken()).toBe('retry-token');
  });

  it('does not retry more than once even if the retry also fails', async () => {
    vi.useFakeTimers();
    mockGetToken.mockRejectedValue(new Error('still unavailable'));

    const service = new MobilePushService();
    await service.initialize();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockGetToken).toHaveBeenCalledTimes(2);
    expect(service.getToken()).toBeNull();
  });

  it('propagates an error thrown by requestPermissions', async () => {
    mockRequestPermissions.mockRejectedValue(new Error('permission API unavailable'));
    const service = new MobilePushService();

    await expect(service.initialize()).rejects.toThrow('permission API unavailable');
  });
});

describe('registerTokenWithServer()', () => {
  it('logs a warning and does nothing without a stored token', async () => {
    const service = new MobilePushService();
    await service.registerTokenWithServer();

    expect(mockRegisterToken).not.toHaveBeenCalled();
    expect(gates.notifications.registerPushToken).not.toHaveBeenCalled();
    expect(mockLogPush).toHaveBeenCalledWith('No FCM token available to register', expect.anything());
  });

  it('registers via the ZM REST API in direct mode', async () => {
    gates.notifications.getProfileSettings = vi.fn().mockReturnValue(
      makeSettings({
        notificationMode: 'direct',
        allMonitors: false,
        monitorFilters: [
          { monitorId: 1, enabled: true, checkInterval: 120 },
          { monitorId: 2, enabled: false, checkInterval: 60 },
        ],
      })
    );
    mockRegisterToken.mockResolvedValue({ Id: 42 });

    const service = new MobilePushService();
    await service.initialize();
    await service.registerTokenWithServer();

    expect(mockRegisterToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        token: 'fcm-token-123',
        platform: 'android',
        monitorList: '1',
        interval: 120,
        pushState: 'enabled',
        profile: 'Home',
      })
    );
    expect(gates.notifications.updateProfileSettings).toHaveBeenCalledWith('profile-1', { notificationId: 42 });
  });

  it('swallows a direct-mode registration failure instead of throwing', async () => {
    gates.notifications.getProfileSettings = vi.fn().mockReturnValue(makeSettings({ notificationMode: 'direct' }));
    mockRegisterToken.mockRejectedValue(new Error('server rejected token'));

    const service = new MobilePushService();
    await service.initialize();

    await expect(service.registerTokenWithServer()).resolves.toBeUndefined();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Failed to register FCM token via ZM API',
      expect.anything(),
      expect.any(Error)
    );
  });

  it('defers registration when in ES mode but not yet connected', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    const service = new MobilePushService();
    await service.initialize();

    expect(gates.notifications.registerPushToken).not.toHaveBeenCalled();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Storing FCM token - will register when connected to notification server',
      expect.anything()
    );
  });

  it('swallows an ES-mode registration failure instead of throwing', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(true);
    gates.notifications.registerPushToken = vi.fn().mockRejectedValue(new Error('socket closed'));

    const service = new MobilePushService();
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Failed to register FCM token with server',
      expect.anything(),
      expect.any(Error)
    );
  });

  it('does nothing when no profile is currently connected', async () => {
    gates.notifications.getCurrentProfileId = vi.fn().mockReturnValue(null);
    const service = new MobilePushService();
    await service.initialize();

    expect(gates.notifications.getProfileSettings).not.toHaveBeenCalled();
    expect(mockLogPush).toHaveBeenCalledWith('No profile connected - cannot register token', expect.anything());
  });
});

describe('deregister()', () => {
  it('logs and returns when there is no token to deregister', async () => {
    const service = new MobilePushService();
    await service.deregister();

    expect(mockLogPush).toHaveBeenCalledWith('No FCM token to deregister', expect.anything());
    expect(mockRemoveAllListeners).not.toHaveBeenCalled();
  });

  it('deletes the server-side notification row in direct mode and clears notificationId', async () => {
    gates.notifications.getProfileSettings = vi.fn().mockReturnValue(
      makeSettings({ notificationMode: 'direct', notificationId: 99 })
    );
    const service = new MobilePushService();
    await service.initialize();

    await service.deregister();

    expect(mockDeleteNotification).toHaveBeenCalledWith(expect.anything(), 99);
    expect(gates.notifications.updateProfileSettings).toHaveBeenCalledWith('profile-1', { notificationId: null });
    expect(mockRemoveAllListeners).toHaveBeenCalled();
    expect(mockDeleteToken).toHaveBeenCalled();
    expect(service.getToken()).toBeNull();
  });

  it('skips the delete call in direct mode when there is no stored notificationId', async () => {
    gates.notifications.getProfileSettings = vi.fn().mockReturnValue(
      makeSettings({ notificationMode: 'direct', notificationId: null })
    );
    const service = new MobilePushService();
    await service.initialize();

    await service.deregister();

    expect(mockDeleteNotification).not.toHaveBeenCalled();
    expect(mockRemoveAllListeners).toHaveBeenCalled();
  });

  it('sends the deregister message directly when already connected to the ES', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(true);
    const service = new MobilePushService();
    await service.initialize();

    await service.deregister();

    expect(gates.notifications.deregisterPushToken).toHaveBeenCalledWith('fcm-token-123', 'android');
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockRemoveAllListeners).toHaveBeenCalled();
  });

  it('opens a temporary ES connection to deregister when not connected', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    const service = new MobilePushService();
    await service.initialize();

    vi.useFakeTimers();
    const deregisterPromise = service.deregister();
    await vi.runAllTimersAsync();
    await deregisterPromise;

    expect(mockConnect).toHaveBeenCalled();
    expect(mockDeregisterPushTokenOnService).toHaveBeenCalledWith('fcm-token-123', 'android', 'Home');
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockRemoveAllListeners).toHaveBeenCalled();
  });

  it('skips the temporary connection when no ES host is configured', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    gates.notifications.getProfileSettings = vi.fn().mockReturnValue(makeSettings({ host: '' }));
    const service = new MobilePushService();
    await service.initialize();

    await service.deregister();

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Cannot deregister via temp connection - no ES host configured',
      expect.anything(),
      expect.objectContaining({ profileId: 'profile-1' })
    );
    // Local unregister still proceeds even though the server-side deregister was skipped.
    expect(mockRemoveAllListeners).toHaveBeenCalled();
  });

  it('skips the temporary connection when the profile has no username', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    gates.profile.getProfiles = vi.fn().mockReturnValue([{ ...PROFILE, username: undefined }]);
    const service = new MobilePushService();
    await service.initialize();

    await service.deregister();

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Cannot deregister via temp connection - no username',
      expect.anything(),
      expect.anything()
    );
  });

  it('skips the temporary connection when the password cannot be decrypted', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    gates.profile.getDecryptedPassword = vi.fn().mockResolvedValue(undefined);
    const service = new MobilePushService();
    await service.initialize();

    await service.deregister();

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockLogPush).toHaveBeenCalledWith(
      'Cannot deregister via temp connection - failed to decrypt password',
      expect.anything(),
      expect.anything()
    );
  });

  it('rethrows and does not run local unregister when the server-side deregister fails', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(true);
    gates.notifications.deregisterPushToken = vi.fn().mockRejectedValue(new Error('deregister rejected'));
    const service = new MobilePushService();
    await service.initialize();

    await expect(service.deregister()).rejects.toThrow('deregister rejected');
    expect(mockRemoveAllListeners).not.toHaveBeenCalled();
    // Token is only cleared by the local unregister step, which never ran.
    expect(service.getToken()).toBe('fcm-token-123');
  });

  it('accepts an overrideProfileId when the store profile has already been cleared', async () => {
    gates.notifications.getCurrentProfileId = vi.fn().mockReturnValue(null);
    gates.notifications.isConnected = vi.fn().mockReturnValue(true);
    const service = new MobilePushService();
    // Force a token onto the service without going through initialize(), which
    // requires a current profile.
    (service as unknown as { currentToken: string }).currentToken = 'fcm-token-123';

    await service.deregister('profile-1');

    expect(gates.notifications.getProfileSettings).toHaveBeenCalledWith('profile-1');
    expect(gates.notifications.deregisterPushToken).toHaveBeenCalledWith('fcm-token-123', 'android');
  });
});

describe('foreground notification handling', () => {
  async function initAndGetListener(event: 'notificationReceived' | 'notificationActionPerformed') {
    const service = new MobilePushService();
    await service.initialize();
    const call = mockAddListener.mock.calls.find((c) => (c[0] as string) === event);
    if (!call) throw new Error(`listener for ${event} was not registered`);
    return { service, listener: call[1] as (arg: unknown) => void };
  }

  it('ignores a foreground push when already connected via websocket (avoids duplicate handling)', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(true);
    const { listener } = await initAndGetListener('notificationReceived');

    listener({ notification: { title: 'Front Door Alarm', body: 'Motion detected', data: { eid: '5', mid: '1' } } });

    expect(gates.notifications.addEvent).not.toHaveBeenCalled();
  });

  it('records a same-profile foreground push as a notification event', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-1', isCrossProfile: false });
    const { listener } = await initAndGetListener('notificationReceived');

    listener({
      notification: {
        title: 'Front Door Alarm',
        body: 'Motion detected',
        data: { eid: '5', mid: '1', monitorName: 'Front Door', cause: 'Motion' },
      },
    });

    expect(gates.notifications.addEvent).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ MonitorId: 1, EventId: 5, MonitorName: 'Front Door', Cause: 'Motion' }),
      'push'
    );
  });

  it('does nothing when the notification cannot be resolved to any profile', async () => {
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: null, isCrossProfile: false });
    const { listener } = await initAndGetListener('notificationReceived');

    listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '5' } } });

    expect(gates.notifications.addEvent).not.toHaveBeenCalled();
  });

  it('records a push with no event id as EventId 0 and no image url (issue #242)', async () => {
    // A push delivered without an eid must not fabricate a Date.now() id, which
    // would later drive a bogus /index.php?view=image&eid=<timestamp> request.
    gates.notifications.isConnected = vi.fn().mockReturnValue(false);
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-1', isCrossProfile: false });
    const { listener } = await initAndGetListener('notificationReceived');

    listener({ notification: { title: 'Front Door Alarm', body: 'Motion', data: {} } });

    expect(gates.notifications.addEvent).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ EventId: 0, ImageUrl: undefined }),
      'push'
    );
  });
});

describe('notification tap handling', () => {
  async function initAndGetListener() {
    const service = new MobilePushService();
    await service.initialize();
    const call = mockAddListener.mock.calls.find((c) => (c[0] as string) === 'notificationActionPerformed');
    if (!call) throw new Error('notificationActionPerformed listener was not registered');
    return { service, listener: call[1] as (arg: unknown) => void };
  }

  it('navigates directly to the event when the tap is for the current profile', async () => {
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-1', isCrossProfile: false });
    const { listener } = await initAndGetListener();

    listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '5', mid: '1' } } });

    expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-1', expect.objectContaining({ EventId: 5 }), 'push');
    expect(gates.notifications.markEventRead).toHaveBeenCalledWith('profile-1', 5);
    expect(mockNavigateToEvent).toHaveBeenCalledWith('5', { from: '/monitors', fromNotification: true });
    expect(mockRequestProfileSwitch).not.toHaveBeenCalled();
  });

  it('requests a profile-switch confirmation for a cross-profile tap instead of navigating', async () => {
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-2', isCrossProfile: true });
    gates.profile.getProfiles = vi.fn().mockReturnValue([PROFILE, { ...PROFILE, id: 'profile-2', name: 'Work' }]);
    const { listener } = await initAndGetListener();

    listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '9', mid: '2', profile: 'Work' } } });

    expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-2', expect.objectContaining({ EventId: 9 }), 'push');
    expect(mockNavigateToEvent).not.toHaveBeenCalled();
    expect(mockRequestProfileSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ targetProfileId: 'profile-2', targetProfileName: 'Work', eventId: '9' })
    );
  });

  it('does not navigate or request a switch when the payload has no event id', async () => {
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-1', isCrossProfile: false });
    const { listener } = await initAndGetListener();

    listener({ notification: { title: 'Alarm', body: 'Motion', data: {} } });

    expect(mockNavigateToEvent).not.toHaveBeenCalled();
    expect(mockRequestProfileSwitch).not.toHaveBeenCalled();
  });

  it('stores an id-less tap as EventId 0 and does not mark a fabricated id read (issue #242)', async () => {
    mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-1', isCrossProfile: false });
    const { listener } = await initAndGetListener();

    listener({ notification: { title: 'Alarm', body: 'Motion', data: {} } });

    expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-1', expect.objectContaining({ EventId: 0 }), 'push');
    expect(gates.notifications.markEventRead).not.toHaveBeenCalled();
  });

  describe('All mode (app-level active profile is the ALL_PROFILES_ID sentinel)', () => {
    it('navigates via the /all/ route with no switch prompt when the tap matches a known profile', async () => {
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(ALL_PROFILES_ID);
      gates.profile.getProfiles = vi.fn().mockReturnValue([PROFILE, { ...PROFILE, id: 'profile-2', name: 'Work' }]);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-2', isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '7', mid: '2', profile: 'Work' } } });

      expect(mockResolveProfileForNotification).toHaveBeenCalledWith('Work', ALL_PROFILES_ID);
      expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-2', expect.objectContaining({ EventId: 7 }), 'push');
      expect(gates.notifications.markEventRead).toHaveBeenCalledWith('profile-2', 7);
      expect(mockRequestProfileSwitch).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockNavigateToEvent).toHaveBeenCalledWith(
        '7',
        { from: '/monitors', fromNotification: true },
        'profile-2'
      );
    });

    // refs #337 I8: a profile-less (or unmatched-name) payload in All mode
    // used to fall all the way through to the generic /events list, even
    // though there IS a real profile available to attribute it to - the one
    // this app instance is actually ES-connected to. gates.notifications.
    // getCurrentProfileId() defaults to 'profile-1' (makeFakeGates above),
    // so that's the expected fallback target here.
    it('falls back to the ES-connected profile\'s /all/ route and history when the tap does not match a known profile (refs #337 I8)', async () => {
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(ALL_PROFILES_ID);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: ALL_PROFILES_ID, isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '11', mid: '9', profile: 'Deleted Server' } } });

      expect(mockRequestProfileSwitch).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockNavigateToEvent).toHaveBeenCalledWith(
        '11',
        { from: '/monitors', fromNotification: true },
        'profile-1'
      );
      // Stored under the real ES-connected profile, never the aggregate
      // sentinel bucket (nothing reads profileEvents[ALL_PROFILES_ID]).
      expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-1', expect.objectContaining({ EventId: 11 }), 'push');
      expect(gates.notifications.markEventRead).toHaveBeenCalledWith('profile-1', 11);
    });

    it('stores an id-less, unmatched-profile tap under the ES-connected profile as EventId 0, never the sentinel (refs #337 I8)', async () => {
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(ALL_PROFILES_ID);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: ALL_PROFILES_ID, isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { profile: 'Deleted Server' } } });

      expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-1', expect.objectContaining({ EventId: 0 }), 'push');
      // Id 0 is not a real ZM event - never marked read (issue #242), same
      // as the single-profile id-less case above.
      expect(gates.notifications.markEventRead).not.toHaveBeenCalled();
    });

    it('falls back to the aggregated events list only when there is no ES-connected profile either', async () => {
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(ALL_PROFILES_ID);
      gates.notifications.getCurrentProfileId = vi.fn().mockReturnValue(null);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: ALL_PROFILES_ID, isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '11', mid: '9', profile: 'Deleted Server' } } });

      expect(mockRequestProfileSwitch).not.toHaveBeenCalled();
      expect(mockNavigateToEvent).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/events', false, { from: '/monitors', fromNotification: true });
      // Never write into the aggregate sentinel's event bucket: nothing reads
      // profileEvents[ALL_PROFILES_ID], so an entry there is a permanently
      // unread, unclearable stuck badge (refs #337).
      expect(gates.notifications.addEvent).not.toHaveBeenCalled();
      expect(gates.notifications.markEventRead).not.toHaveBeenCalled();
    });
  });

  describe('a virtual profile is the app-level active profile (refs #337)', () => {
    const VIRTUAL_ID = mintVirtualProfileId();

    it('resolves the tap against the group id, not the ES-connected profile', async () => {
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(VIRTUAL_ID);
      gates.profile.getProfiles = vi.fn().mockReturnValue([PROFILE, { ...PROFILE, id: 'profile-2', name: 'Work' }]);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: 'profile-2', isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '7', mid: '2', profile: 'Work' } } });

      expect(mockResolveProfileForNotification).toHaveBeenCalledWith('Work', VIRTUAL_ID);
      expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-2', expect.objectContaining({ EventId: 7 }), 'push');
      expect(mockRequestProfileSwitch).not.toHaveBeenCalled();
      expect(mockNavigateToEvent).toHaveBeenCalledWith(
        '7',
        { from: '/monitors', fromNotification: true },
        'profile-2'
      );
    });

    it('stores an unmatched tap in the ES-connected profile\'s bucket, never the group\'s', async () => {
      // The group id names no server, so nothing ever reads
      // profileEvents[groupId] - an entry there would be a permanently
      // unread, unclearable stuck badge, exactly as under the ALL sentinel.
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(VIRTUAL_ID);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: VIRTUAL_ID, isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '11', mid: '9', profile: 'Deleted Server' } } });

      expect(gates.notifications.addEvent).toHaveBeenCalledWith('profile-1', expect.objectContaining({ EventId: 11 }), 'push');
      expect(gates.notifications.addEvent).not.toHaveBeenCalledWith(VIRTUAL_ID, expect.anything(), expect.anything());
      expect(mockNavigateToEvent).toHaveBeenCalledWith(
        '11',
        { from: '/monitors', fromNotification: true },
        'profile-1'
      );
    });

    it('writes nothing at all when there is no ES-connected profile to attribute the tap to', async () => {
      gates.profile.getCurrentProfileId = vi.fn().mockReturnValue(VIRTUAL_ID);
      gates.notifications.getCurrentProfileId = vi.fn().mockReturnValue(null);
      mockResolveProfileForNotification.mockReturnValue({ targetProfileId: VIRTUAL_ID, isCrossProfile: false });
      const { listener } = await initAndGetListener();

      listener({ notification: { title: 'Alarm', body: 'Motion', data: { eid: '11', mid: '9', profile: 'Deleted Server' } } });

      expect(gates.notifications.addEvent).not.toHaveBeenCalled();
      expect(mockNavigateToEvent).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/events', false, { from: '/monitors', fromNotification: true });
    });
  });
});

describe('getPushService() / resetPushService()', () => {
  it('returns the same instance until reset', () => {
    const a = getPushService();
    const b = getPushService();
    expect(a).toBe(b);
  });

  it('creates a fresh, unregistered instance after reset', async () => {
    const first = getPushService();
    await first.initialize();
    expect(first.isReady()).toBe(true);

    resetPushService();

    const second = getPushService();
    expect(second).not.toBe(first);
    expect(second.isReady()).toBe(false);
    expect(second.getToken()).toBeNull();
  });

  it('unregisters the previous instance locally on reset', async () => {
    const first = getPushService();
    await first.initialize();
    mockRemoveAllListeners.mockClear();
    mockDeleteToken.mockClear();

    resetPushService();
    // _unregister() runs fire-and-forget; flush the macrotask queue so its
    // dynamic import + two awaited plugin calls settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRemoveAllListeners).toHaveBeenCalled();
    expect(mockDeleteToken).toHaveBeenCalled();
  });
});
