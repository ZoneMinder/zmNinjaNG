/**
 * Mobile Push Notifications Service
 *
 * Handles FCM push notifications for mobile platforms (iOS/Android)
 * Uses @capacitor-firebase/messaging to get FCM tokens on both platforms.
 * Integrates with ZoneMinder event notification server.
 */

import { Capacitor } from '@capacitor/core';
import type { Notification } from '@capacitor-firebase/messaging';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { navigationService } from '../lib/navigation';
import type { NotificationSettings, NotificationSource } from '../types/notifications';
import type { Profile } from '../api/types';
import { asProfileId, ALL_PROFILES_ID } from '../api/types';
import { registerToken, deleteNotification } from '../api/notifications';
import { getSession } from './sessions';
import { getAppVersion } from '../lib/version';
import { getEventImageUrl } from '../lib/zm/url-builder';
import { NOTIFICATIONS_SERVICE } from '../lib/zmninja-ng-constants';
import { ZMNotificationService } from './notifications';
import type { ZMEventServerConfig, ZMAlarmEvent } from '../types/notifications';
import { resolveProfileForNotification, requestProfileSwitch } from '../lib/profile/notification-profile';

/**
 * Store-derived gates for MobilePushService, injected instead of importing
 * stores/notifications, stores/profile, and stores/auth directly. Those
 * stores (mainly stores/notifications.ts) dynamically import this service,
 * so a static import back here would form a cycle. stores/notifications.ts
 * assembles the real gate from all three stores and registers it at module
 * load. Refs #217.
 */
export interface PushServiceStoreGates {
  notifications: {
    getCurrentProfileId(): string | null;
    getProfileSettings(profileId: string): NotificationSettings;
    isConnected(): boolean;
    updateProfileSettings(profileId: string, updates: Partial<NotificationSettings>): void;
    deregisterPushToken(token: string, platform: 'ios' | 'android'): Promise<void>;
    registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void>;
    addEvent(profileId: string, event: ZMAlarmEvent, source: NotificationSource): void;
    markEventRead(profileId: string, eventId: number): void;
  };
  profile: {
    getProfiles(): Profile[];
    getDecryptedPassword(profileId: string): Promise<string | undefined>;
    /** App-level active profile id (may be the All-mode sentinel), distinct
     *  from notifications.getCurrentProfileId() which tracks the connected
     *  ES/direct-poll profile only. */
    getCurrentProfileId(): string | null;
  };
  auth: {
    getAccessToken(): string | null;
  };
}

let storeGates: PushServiceStoreGates | null = null;

/** Registers the real store-backed gate. Called once by stores/notifications.ts at load time. */
export function setPushServiceStoreGates(gates: PushServiceStoreGates): void {
  storeGates = gates;
}

function getStoreGates(): PushServiceStoreGates {
  if (!storeGates) {
    throw new Error('Push service store gates not initialized. Call setPushServiceStoreGates first.');
  }
  return storeGates;
}

/**
 * Data payload sent by zmeventnotificationNg server via FCM.
 * ES sends mid (monitor ID), eid (event ID), and since ES 7.x+
 * also monitorName and cause as structured fields.
 */
export interface PushNotificationData {
  // ES format fields
  mid?: string;
  eid?: string;
  monitorName?: string;
  cause?: string;
  notification_foreground?: string;
  profile?: string;
  // ZM direct mode format fields
  MonitorId?: string;
  EventId?: string;
  MonitorName?: string;
  Cause?: string;
}

export class MobilePushService {
  private isInitialized = false;
  private currentToken: string | null = null;

  /**
   * Initialize push notifications (mobile only)
   */
  public async initialize(): Promise<void> {
    if (!Platform.isNative) {
      log.push('Push notifications not available on web platform', LogLevel.INFO);
      return;
    }

    log.push('Initializing push notifications', LogLevel.INFO);

    try {
      // Request permission
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      const permissionResult = await FirebaseMessaging.requestPermissions();

      if (permissionResult.receive === 'granted') {
        log.push('Push notification permission granted', LogLevel.INFO);

        // Create Android notification channel (no-op on iOS/web)
        if (Capacitor.getPlatform() === 'android') {
          await this._createNotificationChannel();
        }

        // Setup listeners BEFORE requesting token to ensure we catch token refreshes.
        // Must be awaited: this was previously fire-and-forget, so there was no
        // actual guarantee the listeners were attached before the token request
        // below completed, despite the comment's stated intent.
        if (!this.isInitialized) {
          await this._setupListeners();
          this.isInitialized = true;
        }

        // Get current FCM token
        log.push('Requesting FCM token via getToken()', LogLevel.INFO);
        try {
          const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
          const result = await FirebaseMessaging.getToken();
          this.currentToken = result.token;
          this.hasRetried = false;

          log.push('FCM token received', LogLevel.INFO, {
            token: result.token.substring(0, 20) + '...',
          });

          // Register token with ZM notification server
          this._registerWithServer(result.token);
        } catch (tokenError) {
          log.push('FCM token request failed', LogLevel.ERROR, tokenError);

          if (!this.hasRetried) {
            this.hasRetried = true;
            log.push('Retrying FCM token request once after 5s...', LogLevel.INFO);

            setTimeout(async () => {
              try {
                const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
                const retryResult = await FirebaseMessaging.getToken();
                this.currentToken = retryResult.token;

                log.push('FCM token received on retry', LogLevel.INFO, {
                  token: retryResult.token.substring(0, 20) + '...',
                });

                this._registerWithServer(retryResult.token);
              } catch (e) {
                log.push('FCM token retry failed', LogLevel.ERROR, e);
              }
            }, 5000);
          }
        }

        log.push('Push notifications initialized successfully', LogLevel.INFO);
      } else {
        log.push('Push notification permission denied', LogLevel.WARN, {
          receive: permissionResult.receive,
        });
      }
    } catch (error) {
      log.push('Failed to initialize push notifications', LogLevel.ERROR, error);
      throw error;
    }
  }

  /**
   * Get current FCM token
   */
  public getToken(): string | null {
    return this.currentToken;
  }

  /**
   * Check if push notifications are initialized
   */
  public isReady(): boolean {
    return this.isInitialized && this.currentToken !== null;
  }

  /**
   * Register token with notification server if connected
   * Can be called after connection is established
   */
  public async registerTokenWithServer(): Promise<void> {
    if (!this.currentToken) {
      log.push('No FCM token available to register', LogLevel.WARN);
      return;
    }

    await this._registerWithServer(this.currentToken);
  }

  /**
   * Deregister from push notifications and notify server.
   * @param overrideProfileId - Profile ID to deregister for. Required because
   *   the store's currentProfileId may already be null if disconnect() was
   *   called before this method (e.g., when updateProfileSettings triggers
   *   an automatic disconnect).
   */
  public async deregister(overrideProfileId?: string): Promise<void> {
    if (!Platform.isNative) {
      return;
    }

    if (!this.currentToken) {
      log.push('No FCM token to deregister', LogLevel.INFO);
      return;
    }

    log.push('Deregistering from push notifications', LogLevel.INFO);

    try {
      const gates = getStoreGates().notifications;
      const profileId = overrideProfileId || gates.getCurrentProfileId();

      if (profileId) {
        const settings = gates.getProfileSettings(profileId);

        if (settings.notificationMode === 'direct') {
          // Direct mode: delete via ZM REST API
          const notifId = settings.notificationId;
          if (notifId) {
            log.push('Deleting notification via ZM API (direct mode)', LogLevel.INFO, { notificationId: notifId });
            await deleteNotification(getSession(asProfileId(profileId)).client, notifId);
            gates.updateProfileSettings(profileId, { notificationId: null });
          }
        } else {
          // ES mode: deregister via websocket
          const platform = Capacitor.getPlatform() as 'ios' | 'android';

          if (gates.isConnected()) {
            // Already connected: send directly
            log.push('Sending disabled state to notification server', LogLevel.INFO, { platform });
            await gates.deregisterPushToken(this.currentToken, platform);
          } else {
            // Not connected: temporarily connect to send the deregister
            log.push('Not connected to ES, using temporary connection to deregister', LogLevel.INFO, { platform });
            await this._deregisterViaTemporaryConnection(profileId, this.currentToken, platform);
          }
        }
      }

      // Unregister locally
      await this._unregister();
    } catch (error) {
      log.push('Failed to deregister from push notifications', LogLevel.ERROR, error);
      throw error;
    }
  }

  /**
   * Establish a temporary WebSocket connection to the EventServer
   * solely to send a push token deregistration message, then disconnect.
   */
  private async _deregisterViaTemporaryConnection(
    profileId: string,
    token: string,
    platform: 'ios' | 'android'
  ): Promise<void> {
    const gates = getStoreGates();
    const settings = gates.notifications.getProfileSettings(profileId);

    if (!settings.host) {
      log.push('Cannot deregister via temp connection - no ES host configured', LogLevel.WARN, { profileId });
      return;
    }

    const profiles = gates.profile.getProfiles();
    const profile = profiles.find(p => p.id === profileId);

    if (!profile?.username) {
      log.push('Cannot deregister via temp connection - no username', LogLevel.WARN, { profileId });
      return;
    }

    const password = await gates.profile.getDecryptedPassword(profileId);

    if (!password) {
      log.push('Cannot deregister via temp connection - failed to decrypt password', LogLevel.WARN, { profileId });
      return;
    }

    const config: ZMEventServerConfig = {
      host: settings.host,
      port: settings.port,
      ssl: settings.ssl,
      username: profile.username,
      password,
      appVersion: getAppVersion(),
    };

    const tempService = new ZMNotificationService();

    try {
      await tempService.connect(config);
      await tempService.deregisterPushToken(token, platform, profile.name);

      // Brief delay to let the WebSocket flush the send buffer
      await new Promise(resolve => setTimeout(resolve, 200));

      log.push('Deregistered push token via temporary ES connection', LogLevel.INFO, { profileId });
    } catch (error) {
      log.push('Failed to deregister via temporary ES connection', LogLevel.ERROR, error);
    } finally {
      tempService.disconnect();
    }
  }

  /**
   * Unregister from push notifications (local only)
   */
  private async _unregister(): Promise<void> {
    if (!Platform.isNative) {
      return;
    }

    log.push('Unregistering from push notifications locally', LogLevel.INFO);

    try {
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      // Remove all listeners
      await FirebaseMessaging.removeAllListeners();

      // Delete FCM token
      await FirebaseMessaging.deleteToken();

      // Clear token
      this.currentToken = null;
      this.isInitialized = false;

      log.push('Unregistered from push notifications', LogLevel.INFO);
    } catch (error) {
      log.push('Failed to unregister from push notifications', LogLevel.ERROR, error);
    }
  }

  // Single retry flag to prevent infinite retry loops
  private hasRetried = false;

  // ========== PRIVATE METHODS ==========

  /**
   * Create the Android notification channel used by FCM push messages.
   * This is idempotent: calling it when the channel already exists is a no-op.
   */
  private async _createNotificationChannel(): Promise<void> {
    try {
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      await FirebaseMessaging.createChannel({
        id: 'zmninja-ng',
        name: 'zmNinja Notifications',
        description: 'ZoneMinder event alerts',
        importance: 4, // IMPORTANCE_HIGH, heads-up notifications
        vibration: true,
      });
      log.push('Android notification channel created', LogLevel.INFO, { channelId: 'zmninja-ng' });
    } catch (error) {
      log.push('Failed to create notification channel', LogLevel.ERROR, error);
    }
  }

  private async _setupListeners(): Promise<void> {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

    // Called when FCM token is refreshed
    FirebaseMessaging.addListener('tokenReceived', ({ token }) => {
      log.push('FCM token refreshed', LogLevel.INFO, {
        token: token.substring(0, 20) + '...',
      });

      this.currentToken = token;
      this.hasRetried = false;

      // Register refreshed token with ZM notification server
      this._registerWithServer(token);
    });

    // Called when notification is received while app is in foreground
    FirebaseMessaging.addListener(
      'notificationReceived',
      ({ notification }) => {
        log.push('Push notification received (foreground)', LogLevel.INFO, {
          title: notification.title,
          body: notification.body,
          data: notification.data,
        });

        // Handle the notification data
        this._handleNotification(notification);
      }
    );

    // Called when user taps on notification
    FirebaseMessaging.addListener(
      'notificationActionPerformed',
      ({ notification }) => {
        log.push('Push notification action performed', LogLevel.INFO, {
          notification,
        });

        // Handle the tap action
        this._handleNotificationAction(notification);
      }
    );
  }

  private async _registerWithServer(token: string): Promise<void> {
    const gates = getStoreGates();
    const profileId = gates.notifications.getCurrentProfileId();
    if (!profileId) {
      log.push('No profile connected - cannot register token', LogLevel.WARN);
      return;
    }

    const settings = gates.notifications.getProfileSettings(profileId);

    if (settings.notificationMode === 'direct') {
      // Direct mode: register via ZM REST API (no websocket needed)
      try {
        const platform = Capacitor.getPlatform() as 'android' | 'ios';
        const enabledFilters = settings.monitorFilters.filter(f => f.enabled);
        const monitorList = settings.allMonitors ? undefined : enabledFilters.map(f => f.monitorId).join(',');
        const interval = settings.allMonitors ? 0 : Math.max(0, ...enabledFilters.map(f => f.checkInterval));

        const profiles = gates.profile.getProfiles();
        const currentProfile = profiles.find(p => p.id === profileId);

        log.push('Registering FCM token via ZM REST API (direct mode)', LogLevel.INFO, { platform, profile: currentProfile?.name });

        const result = await registerToken(getSession(asProfileId(profileId)).client, {
          token,
          platform,
          monitorList,
          interval,
          pushState: 'enabled',
          appVersion: getAppVersion(),
          profile: currentProfile?.name,
        });

        gates.notifications.updateProfileSettings(profileId, { notificationId: result.Id });
        log.push('Successfully registered FCM token via ZM API', LogLevel.INFO, { notificationId: result.Id });
      } catch (error) {
        log.push('Failed to register FCM token via ZM API', LogLevel.ERROR, error);
      }
    } else {
      // ES mode: register via websocket
      if (!gates.notifications.isConnected()) {
        log.push('Storing FCM token - will register when connected to notification server', LogLevel.INFO);
        return;
      }

      try {
        const platform = Capacitor.getPlatform() as 'ios' | 'android';

        log.push('Registering FCM token with notification server', LogLevel.INFO, {
          platform,
        });

        await gates.notifications.registerPushToken(token, platform);

        log.push('Successfully registered FCM token with server', LogLevel.INFO);
      } catch (error) {
        log.push('Failed to register FCM token with server', LogLevel.ERROR, error);
      }
    }
  }

  /**
   * Handle incoming push notification when app is in foreground
   */
  private _handleNotification(notification: Notification): void {
    const data = notification.data as PushNotificationData | undefined;

    log.push('Processing FCM notification (foreground)', LogLevel.INFO, {
      title: notification.title,
      body: notification.body,
      data: notification.data,
    });

    const gates = getStoreGates();

    // If we are connected to the event server, we will receive this event via WebSocket.
    // Ignore the push notification to avoid duplicate processing/toasts.
    if (gates.notifications.isConnected()) {
      log.push('Ignoring foreground push notification - already connected to event server', LogLevel.INFO, {
        eventId: data?.eid,
      });
      return;
    }

    const currentProfileId = gates.notifications.getCurrentProfileId();
    if (!currentProfileId) return;

    // Resolve which profile this notification belongs to
    const { targetProfileId } = resolveProfileForNotification(data?.profile, currentProfileId);
    if (!targetProfileId) return;

    const profiles = gates.profile.getProfiles();
    const targetProfile = profiles.find(p => p.id === targetProfileId);
    const accessToken = gates.auth.getAccessToken();

    // Extract event data from either ES format (mid/eid) or ZM direct format (EventId/MonitorId)
    const mid = data?.mid || data?.MonitorId;
    const eid = data?.eid || data?.EventId;

    // Only construct image URL if the notification is for the current profile
    // (we have a valid auth token for the current profile only)
    let imageUrl: string | undefined;
    if (eid && targetProfileId === currentProfileId && targetProfile && accessToken) {
      imageUrl = getEventImageUrl(targetProfile.portalUrl, String(eid), 'snapshot', {
        token: accessToken,
        width: NOTIFICATIONS_SERVICE.snapshotImageWidth,
      });
    }

    const monitorName = data?.monitorName || data?.MonitorName || notification.title?.replace(/\s*Alarm.*$/, '') || 'Unknown';
    const cause = data?.cause || data?.Cause || notification.body || 'Motion detected';

    gates.notifications.addEvent(targetProfileId, {
      MonitorId: mid ? parseInt(String(mid), 10) : 0,
      MonitorName: monitorName,
      // 0 means "no ZM event". A push can arrive without an eid (e.g. delivered
      // while backgrounded, then read from the tray with its data stripped).
      // Never fabricate an id: it would drive a bogus image request (issue #242).
      EventId: eid ? parseInt(String(eid), 10) : 0,
      Cause: cause,
      Name: monitorName,
      ImageUrl: imageUrl,
    }, 'push');
  }

  /**
   * Handle notification tap action.
   *
   * Resolves the correct profile from the notification payload.
   * If the notification is for the current profile, navigates directly.
   * If it's for a different profile, queues a confirmation dialog
   * so the user can choose whether to switch profiles.
   */
  private _handleNotificationAction(notification: Notification): void {
    const data = notification.data as PushNotificationData | undefined;

    const mid = data?.mid || data?.MonitorId;
    const eid = data?.eid || data?.EventId;

    log.push('Processing notification tap', LogLevel.INFO, { mid, eid, profile: data?.profile });

    const gates = getStoreGates();
    const currentProfileId = gates.notifications.getCurrentProfileId();
    // App-level active profile: the only one that can carry the All-mode
    // sentinel (the ES-connected profile above never does - there's no
    // session for it). Outside All mode this is not consulted, so
    // single-mode taps keep resolving off the ES-connected profile exactly
    // as before (refs #337).
    const appProfileId = gates.profile.getCurrentProfileId();
    const isAllMode = appProfileId === ALL_PROFILES_ID;

    // Resolve which profile this notification belongs to
    const { targetProfileId, isCrossProfile } = resolveProfileForNotification(
      data?.profile,
      isAllMode ? appProfileId : currentProfileId
    );

    // All mode with no (or an unmatched) profile in the payload resolves
    // targetProfileId to the ALL_PROFILES_ID sentinel itself
    // (resolveProfileForNotification's absent-data early return echoes back
    // whatever currentProfileId it was given, which is appProfileId here).
    // Falling back straight to the generic /events list in that case drops
    // the notification's history entry and deep link even though there IS
    // a real profile available: the ES-connected one this app instance is
    // actually listening on. Only when that is ALSO absent does the
    // existing warn+/events fallback below apply (refs #337 I8).
    const effectiveTargetProfileId =
      isAllMode && (!targetProfileId || targetProfileId === ALL_PROFILES_ID)
        ? currentProfileId
        : targetProfileId;

    const profileIdForEvent = effectiveTargetProfileId || currentProfileId;

    // Never write into the aggregate sentinel's own bucket: nothing reads
    // profileEvents[ALL_PROFILES_ID] (NotificationBadge and NotificationHistory
    // both key off a real profile id), so an entry there would be a
    // permanently unread, unclearable stuck badge (refs #337).
    if (profileIdForEvent && profileIdForEvent !== ALL_PROFILES_ID) {
      const profiles = gates.profile.getProfiles();
      const targetProfile = profiles.find(p => p.id === profileIdForEvent);
      const accessToken = gates.auth.getAccessToken();

      // Only construct image URL if the notification is for the current profile
      let imageUrl: string | undefined;
      if (eid && profileIdForEvent === currentProfileId && targetProfile && accessToken) {
        imageUrl = getEventImageUrl(targetProfile.portalUrl, String(eid), 'snapshot', {
          token: accessToken,
          width: NOTIFICATIONS_SERVICE.snapshotImageWidth,
        });
      }

      const monitorName = data?.monitorName || data?.MonitorName || notification.title?.replace(/\s*Alarm.*$/, '') || 'Unknown';
      const cause = data?.cause || data?.Cause || notification.body || 'Motion detected';
      // 0 means "no ZM event"; never fabricate an id (issue #242).
      const eventId = eid ? parseInt(String(eid), 10) : 0;

      // Always store event under the correct profile's history
      gates.notifications.addEvent(profileIdForEvent, {
        MonitorId: mid ? parseInt(String(mid), 10) : 0,
        MonitorName: monitorName,
        EventId: eventId,
        Cause: cause,
        Name: monitorName,
        ImageUrl: imageUrl,
      }, 'push');

      // Only a real event can be marked read; id 0 is not a ZM event.
      if (eventId > 0) {
        gates.notifications.markEventRead(profileIdForEvent, eventId);
      }

      log.push('Added notification to history from tap action', LogLevel.INFO, {
        eventId: eid,
        targetProfileId: profileIdForEvent,
        isCrossProfile,
      });
    }

    if (!eid) return;

    if (isCrossProfile && targetProfileId) {
      // Different profile: request user confirmation before switching
      const profiles = gates.profile.getProfiles();
      const targetProfile = profiles.find(p => p.id === targetProfileId);

      log.push('Cross-profile notification tap, requesting switch confirmation', LogLevel.INFO, {
        targetProfile: targetProfile?.name,
        eventId: eid,
      });

      requestProfileSwitch({
        targetProfileId,
        targetProfileName: targetProfile?.name || data?.profile || 'Unknown',
        eventId: String(eid),
      });
    } else if (isAllMode) {
      if (effectiveTargetProfileId && effectiveTargetProfileId !== ALL_PROFILES_ID) {
        // Known (or ES-connected-fallback) profile while in All mode: no
        // switch needed, deep-link straight into that profile's event via
        // the /all/ route.
        navigationService.navigateToEvent(String(eid), { from: '/monitors', fromNotification: true }, effectiveTargetProfileId);
        log.push('All-mode notification tap, navigating to owning profile event', LogLevel.INFO, {
          targetProfileId: effectiveTargetProfileId,
          eventId: eid,
        });
      } else {
        // Unknown or absent profile while in All mode: no profile to
        // deep-link into (there's no "current" session to fall back to
        // either), so open the aggregated events list instead.
        log.push('All-mode notification tap could not resolve a profile, opening aggregated events list', LogLevel.WARN, {
          notificationProfile: data?.profile,
        });
        navigationService.navigate('/events', false, { from: '/monitors', fromNotification: true });
      }
    } else {
      // Same profile: navigate directly (with fallback route for back button)
      navigationService.navigateToEvent(String(eid), { from: '/monitors', fromNotification: true });
      log.push('Navigating to event detail', LogLevel.INFO, { eventId: eid });
    }
  }
}

// Singleton instance
let pushService: MobilePushService | null = null;

export function getPushService(): MobilePushService {
  if (!pushService) {
    pushService = new MobilePushService();
  }
  return pushService;
}

export function resetPushService(): void {
  if (pushService) {
    pushService['_unregister']().catch((error) => {
      log.push('Failed to unregister push service', LogLevel.ERROR, error);
    });
    pushService = null;
  }
}
