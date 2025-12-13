/**
 * Mobile Push Notifications Service
 *
 * Handles FCM push notifications for mobile platforms (iOS/Android)
 * Integrates with ZoneMinder event notification server
 */

import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { log } from '../lib/logger';
import { navigationService } from '../lib/navigation';
import { useNotificationStore } from '../stores/notifications';

export interface PushNotificationData {
  monitorId?: string;
  monitorName?: string;
  eventId?: string;
  cause?: string;
}

export class MobilePushService {
  private isInitialized = false;
  private currentToken: string | null = null;

  /**
   * Initialize push notifications (mobile only)
   */
  public async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      log.info('Push notifications not available on web platform', { component: 'Push' });
      return;
    }

    if (this.isInitialized) {
      log.info('Push notifications already initialized', { component: 'Push' });
      return;
    }

    log.info('Initializing push notifications', { component: 'Push' });

    try {
      // Request permission
      const permissionResult = await PushNotifications.requestPermissions();

      if (permissionResult.receive === 'granted') {
        log.info('Push notification permission granted', { component: 'Push' });

        // Setup listeners BEFORE registering to ensure we catch the registration event
        this._setupListeners();

        // Register with FCM
        log.info('Calling PushNotifications.register()', { component: 'Push' });
        await PushNotifications.register();
        log.info('PushNotifications.register() called successfully', { component: 'Push' });

        this.isInitialized = true;
        log.info('Push notifications initialized successfully', { component: 'Push' });
      } else {
        log.warn('Push notification permission denied', {
          component: 'Push',
          receive: permissionResult.receive,
        });
      }
    } catch (error) {
      log.error('Failed to initialize push notifications', { component: 'Push' }, error);
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
   * Unregister from push notifications
   */
  public async unregister(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    log.info('Unregistering from push notifications', { component: 'Push' });

    try {
      // Remove all listeners
      await PushNotifications.removeAllListeners();

      // Clear token
      this.currentToken = null;
      this.isInitialized = false;

      log.info('Unregistered from push notifications', { component: 'Push' });
    } catch (error) {
      log.error('Failed to unregister from push notifications', { component: 'Push' }, error);
    }
  }

  // Single retry flag to prevent infinite retry loops
  private hasRetried = false;

  // ========== PRIVATE METHODS ==========

  private _setupListeners(): void {
    // Called when FCM token is received
    PushNotifications.addListener('registration', (token: Token) => {
      log.info('FCM token received', {
        component: 'Push',
        token: token.value.substring(0, 20) + '...', // Truncate for security
      });

      this.currentToken = token.value;
      this.hasRetried = false; // Reset retry flag on success

      // Register token with ZM notification server
      this._registerWithServer(token.value);
    });

    // Called when registration fails
    // Single retry after 5s delay to handle transient network issues on mobile
    PushNotifications.addListener('registrationError', (error) => {
      log.error('FCM registration failed', { component: 'Push' }, error);

      if (!this.hasRetried) {
        this.hasRetried = true;
        log.info('Retrying FCM registration once after 5s...', { component: 'Push' });

        setTimeout(async () => {
          try {
            await PushNotifications.register();
          } catch (e) {
            log.error('FCM registration retry failed', { component: 'Push' }, e);
          }
        }, 5000);
      }
    });

    // Called when notification is received while app is in foreground
    PushNotifications.addListener(
      'pushNotificationReceived',
      (notification: PushNotificationSchema) => {
        log.info('Push notification received (foreground)', {
          component: 'Push',
          title: notification.title,
          body: notification.body,
          data: notification.data,
        });

        // Handle the notification data
        this._handleNotification(notification);
      }
    );

    // Called when user taps on notification
    PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: ActionPerformed) => {
        log.info('Push notification action performed', {
          component: 'Push',
          actionId: action.actionId,
          notification: action.notification,
        });

        // Handle the tap action
        this._handleNotificationAction(action);
      }
    );
  }

  private async _registerWithServer(token: string): Promise<void> {
    const notificationStore = useNotificationStore.getState();

    if (!notificationStore.isConnected) {
      log.warn('Cannot register push token - not connected to notification server', {
        component: 'Push',
      });
      return;
    }

    try {
      const platform = Capacitor.getPlatform() as 'ios' | 'android';

      log.info('Registering FCM token with notification server', {
        component: 'Push',
        platform,
      });

      await notificationStore.registerPushToken(token, platform);

      log.info('Successfully registered FCM token with server', { component: 'Push' });
    } catch (error) {
      log.error('Failed to register FCM token with server', { component: 'Push' }, error);
    }
  }

  private _handleNotification(notification: PushNotificationSchema): void {
    const data = notification.data as PushNotificationData;

    log.info('Processing notification', {
      component: 'Push',
      monitorId: data.monitorId,
      eventId: data.eventId,
    });

    // Extract event data and add to notification store
    if (data.monitorId && data.eventId) {
      const notificationStore = useNotificationStore.getState();

      // If we are connected to the event server, we will receive this event via WebSocket.
      // Ignore the push notification to avoid duplicate processing/toasts.
      if (notificationStore.isConnected) {
        log.info('Ignoring foreground push notification - already connected to event server', {
          component: 'Push',
          eventId: data.eventId,
        });
        return;
      }

      const profileId = notificationStore.currentProfileId;

      if (profileId) {
        notificationStore.addEvent(profileId, {
          MonitorId: parseInt(data.monitorId, 10),
          MonitorName: data.monitorName || 'Unknown',
          EventId: parseInt(data.eventId, 10),
          Cause: data.cause || notification.body || 'Motion detected',
          Name: data.monitorName || 'Unknown',
        });
      }
    }
  }

  private _handleNotificationAction(action: ActionPerformed): void {
    const data = action.notification.data as PushNotificationData;

    log.info('Processing notification tap', {
      component: 'Push',
      actionId: action.actionId,
      monitorId: data.monitorId,
      eventId: data.eventId,
    });

    // Navigate to event detail if we have event ID
    if (data.eventId) {
      // Mark as read
      const notificationStore = useNotificationStore.getState();
      const profileId = notificationStore.currentProfileId;

      if (profileId) {
        notificationStore.markEventRead(profileId, parseInt(data.eventId, 10));
      }

      // Navigate to event detail page
      navigationService.navigateToEvent(data.eventId);

      log.info('Navigating to event detail', { component: 'Push', eventId: data.eventId });
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
    pushService.unregister().catch((error) => {
      log.error('Failed to unregister push service', { component: 'Push' }, error);
    });
    pushService = null;
  }
}
