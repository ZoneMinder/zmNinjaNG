import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationStore, startEventPoller, resolvePollIntervalMs } from '../notifications';
import { getBandwidthSettings } from '../../lib/zmninja-ng-constants';
import type { ZMAlarmEvent } from '../../types/notifications';

const mockService = {
  connect: vi.fn().mockResolvedValue(undefined),
  onStateChange: vi.fn(() => vi.fn()),
  onEvent: vi.fn(() => vi.fn()),
  setMonitorFilter: vi.fn().mockResolvedValue(undefined),
  updateBadgeCount: vi.fn().mockResolvedValue(undefined),
  registerPushToken: vi.fn().mockResolvedValue(undefined),
  deregisterPushToken: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../services/notifications', () => ({
  getNotificationService: vi.fn(() => mockService),
  resetNotificationService: vi.fn(),
}));

const mockPollerStart = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/eventPoller', () => ({
  getEventPoller: vi.fn(() => ({
    start: mockPollerStart,
    stop: vi.fn(),
    isRunning: vi.fn(() => false),
  })),
}));

vi.mock('../auth', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      accessToken: 'access-token',
      getFreshAccessToken: vi.fn().mockResolvedValue('fresh-token'),
    })),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../settings', () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      getProfileSettings: vi.fn(() => ({ bandwidthMode: 'normal' })),
    })),
  },
}));

vi.mock('../../lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    notifications: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('../../lib/version', () => ({
  getAppVersion: vi.fn(() => '1.0.0'),
}));

vi.mock('../../api/notifications', () => ({
  updateNotification: vi.fn().mockResolvedValue({}),
}));

// services/pushNotifications.ts is only reachable dynamically from this store
// (native-only token registration); mock it so the store test doesn't need
// to evaluate the real push service module. setPushServiceStoreGates is
// called at this module's top level (refs #217), so it must exist on the mock.
vi.mock('../../services/pushNotifications', () => ({
  setPushServiceStoreGates: vi.fn(),
  getPushService: vi.fn(() => ({
    isReady: vi.fn(() => false),
    registerTokenWithServer: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Notification Store', () => {
  const profileId = 'profile-1';
  const baseEvent: ZMAlarmEvent = {
    MonitorId: 1,
    MonitorName: 'Front Door',
    EventId: 101,
    Cause: 'Motion',
    Name: 'Front Door',
    ImageUrl: 'https://example.com/1.jpg',
  };

  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.setState({
      profileSettings: {},
      connectionState: 'disconnected',
      isConnected: false,
      currentProfileId: null,
      profileEvents: {},
      _cleanupFunctions: [],
    });
    vi.clearAllMocks();
  });

  it('returns default settings for a profile', () => {
    const settings = useNotificationStore.getState().getProfileSettings(profileId);
    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(9000);
    expect(settings.monitorFilters).toEqual([]);
  });

  it('updates profile settings and disconnects when disabling active profile', () => {
    useNotificationStore.setState({
      isConnected: true,
      currentProfileId: profileId,
    });

    const disconnectSpy = vi.spyOn(useNotificationStore.getState(), 'disconnect');

    useNotificationStore.getState().updateProfileSettings(profileId, {
      enabled: false,
      host: 'example.com',
    });

    const settings = useNotificationStore.getState().getProfileSettings(profileId);
    expect(settings.host).toBe('example.com');
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('adds and updates monitor filters', () => {
    const store = useNotificationStore.getState();

    store.setMonitorFilter(profileId, 1, true, 60);
    store.setMonitorFilter(profileId, 1, false, 120);

    const settings = store.getProfileSettings(profileId);
    expect(settings.monitorFilters).toHaveLength(1);
    expect(settings.monitorFilters[0]).toEqual({
      monitorId: 1,
      enabled: false,
      checkInterval: 120,
    });
  });

  it('removes monitor filters', () => {
    const store = useNotificationStore.getState();

    store.setMonitorFilter(profileId, 1, true, 60);
    store.setMonitorFilter(profileId, 2, true, 60);
    store.removeMonitorFilter(profileId, 1);

    const settings = store.getProfileSettings(profileId);
    expect(settings.monitorFilters).toHaveLength(1);
    expect(settings.monitorFilters[0].monitorId).toBe(2);
  });

  it('adds events and updates badge count', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent);
    store.addEvent(profileId, { ...baseEvent, EventId: 102 });

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(2);
    expect(store.getUnreadCount(profileId)).toBe(2);
    expect(store.getProfileSettings(profileId).badgeCount).toBe(2);
  });

  it('defaults source to websocket', () => {
    const store = useNotificationStore.getState();
    store.addEvent(profileId, baseEvent);
    const events = store.getEvents(profileId);
    expect(events[0].source).toBe('websocket');
  });

  it('stores push source when specified', () => {
    const store = useNotificationStore.getState();
    store.addEvent(profileId, baseEvent, 'push');
    const events = store.getEvents(profileId);
    expect(events[0].source).toBe('push');
  });

  it('replaces duplicate events by EventId', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent);
    store.addEvent(profileId, { ...baseEvent, MonitorName: 'Back Door' });

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(1);
    expect(events[0].MonitorName).toBe('Back Door');
  });

  it('updates source when duplicate event replaces existing', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent, 'websocket');
    store.addEvent(profileId, baseEvent, 'push');

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('push');
  });

  it('marks events read and clears all', () => {
    const store = useNotificationStore.getState();

    store.addEvent(profileId, baseEvent);
    store.addEvent(profileId, { ...baseEvent, EventId: 102 });

    store.markEventRead(profileId, 101);
    expect(store.getUnreadCount(profileId)).toBe(1);

    store.markAllRead(profileId);
    expect(store.getUnreadCount(profileId)).toBe(0);

    store.clearEvents(profileId);
    expect(store.getEvents(profileId)).toHaveLength(0);
  });

  it('limits stored events to 100', () => {
    const store = useNotificationStore.getState();

    for (let i = 1; i <= 150; i += 1) {
      store.addEvent(profileId, { ...baseEvent, EventId: i });
    }

    const events = store.getEvents(profileId);
    expect(events).toHaveLength(100);
    expect(events[0].EventId).toBe(150);
  });

  it('sets notification mode via updateProfileSettings', () => {
    const store = useNotificationStore.getState();

    store.updateProfileSettings(profileId, { notificationMode: 'direct' });
    expect(store.getProfileSettings(profileId).notificationMode).toBe('direct');

    store.updateProfileSettings(profileId, { notificationMode: 'es' });
    expect(store.getProfileSettings(profileId).notificationMode).toBe('es');
  });

  it('sets and clears notification ID via updateProfileSettings', () => {
    const store = useNotificationStore.getState();

    store.updateProfileSettings(profileId, { notificationId: 42 });
    expect(store.getProfileSettings(profileId).notificationId).toBe(42);

    store.updateProfileSettings(profileId, { notificationId: null });
    expect(store.getProfileSettings(profileId).notificationId).toBeNull();
  });

  it('stores poll source when specified', () => {
    const store = useNotificationStore.getState();
    store.addEvent(profileId, baseEvent, 'poll');
    const events = store.getEvents(profileId);
    expect(events[0].source).toBe('poll');
  });

  it('defaults onlyDetectedEvents and pollingInterval', () => {
    const settings = useNotificationStore.getState().getProfileSettings(profileId);
    expect(settings.onlyDetectedEvents).toBe(false);
    expect(settings.pollingInterval).toBe(30);
  });

  it('updates direct mode settings', () => {
    const store = useNotificationStore.getState();

    store.updateProfileSettings(profileId, {
      onlyDetectedEvents: true,
      pollingInterval: 60,
    });

    const settings = store.getProfileSettings(profileId);
    expect(settings.onlyDetectedEvents).toBe(true);
    expect(settings.pollingInterval).toBe(60);
  });

  it('connect injects store-derived providers into the service', async () => {
    const store = useNotificationStore.getState();
    store.updateProfileSettings(profileId, { enabled: true, host: 'es.example.com' });

    await useNotificationStore
      .getState()
      .connect(profileId, 'admin', 'secret', 'http://zm.local');

    expect(mockService.connect).toHaveBeenCalledTimes(1);
    const [config, providers] = mockService.connect.mock.calls[0];

    expect(config).toMatchObject({
      host: 'es.example.com',
      username: 'admin',
      password: 'secret',
    });

    expect(await providers.getFreshAccessToken()).toBe('fresh-token');

    const imageUrl = providers.buildEventImageUrl(42, 'tok');
    expect(imageUrl).toContain('http://zm.local');
    expect(imageUrl).toContain('eid=42');
    expect(imageUrl).toContain('fid=snapshot');
    expect(imageUrl).toContain('width=600');
    expect(imageUrl).toContain('token=tok');

    // No token: builder must omit the token parameter
    expect(providers.buildEventImageUrl(42, null)).not.toContain('token=');

    expect(providers.getKeepaliveIntervalMs()).toBe(60000);
  });

  it('startEventPoller wires store-derived deps into the poller', async () => {
    useNotificationStore
      .getState()
      .updateProfileSettings(profileId, { onlyDetectedEvents: true });

    await startEventPoller(profileId);

    expect(mockPollerStart).toHaveBeenCalledTimes(1);
    const [id, deps] = mockPollerStart.mock.calls[0];
    expect(id).toBe(profileId);

    expect(deps.getOnlyDetectedEvents()).toBe(true);
    expect(await deps.getFreshAccessToken()).toBe('fresh-token');
    expect(deps.getPollIntervalMs()).toBe(30000);

    deps.onEvent(baseEvent);
    const events = useNotificationStore.getState().getEvents(profileId);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('poll');
  });
});

describe('resolvePollIntervalMs', () => {
  const normalDefault = getBandwidthSettings('normal').eventPollerInterval;
  const lowDefault = getBandwidthSettings('low').eventPollerInterval;

  it('honours the user interval in normal bandwidth mode', () => {
    expect(resolvePollIntervalMs('normal', 10)).toBe(10000);
    expect(resolvePollIntervalMs('normal', 120)).toBe(120000);
  });

  it('floors the user interval at the low-bandwidth cadence', () => {
    expect(resolvePollIntervalMs('low', 10)).toBe(lowDefault);
  });

  it('lets the user poll slower than the low-bandwidth cadence', () => {
    expect(resolvePollIntervalMs('low', 120)).toBe(120000);
  });

  it('falls back to the bandwidth default when the stored value is unusable', () => {
    expect(resolvePollIntervalMs('normal', undefined)).toBe(normalDefault);
    expect(resolvePollIntervalMs('normal', 0)).toBe(normalDefault);
    expect(resolvePollIntervalMs('normal', NaN)).toBe(normalDefault);
    expect(resolvePollIntervalMs('low', -5)).toBe(lowDefault);
  });
});
