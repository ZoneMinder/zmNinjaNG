/**
 * useNotificationAutoConnect Hook
 *
 * Manages automatic connection to the notification server when a profile
 * loads. Handles:
 * - Resetting auto-connect state when settings change
 * - Disconnecting when the profile switches
 * - Auto-connecting WebSocket (ES mode) or starting the event poller (direct mode)
 * - Stopping the event poller on cleanup
 * - Network change reconnection (web + native)
 * - Tab visibility / app resume liveness checks
 */

import { useEffect, useRef } from 'react';
import { Platform } from '../lib/platform';
import { log, LogLevel } from '../lib/logger';
import { useNotificationStore, startEventPoller } from '../stores/notifications';
import { getEventPoller } from '../services/eventPoller';
import { getNotificationService } from '../services/notifications';
import { useCapacitorListener } from './useCapacitorListener';
import { NOTIFICATIONS_SERVICE } from '../lib/zmninja-ng-constants';
import type { Profile } from '../api/types';

interface AutoConnectParams {
  currentProfile: Profile | null;
  settings: {
    enabled?: boolean;
    notificationMode?: string;
    host?: string;
  } | null;
  isConnected: boolean;
  connectionState: string;
  currentProfileId: string | null;
  connect: (profileId: string, username: string, password: string, portalUrl: string) => Promise<void>;
  disconnect: () => void;
  reconnect: () => void;
  getDecryptedPassword: (profileId: string) => Promise<string | null | undefined>;
}

export function useNotificationAutoConnect({
  currentProfile,
  settings,
  isConnected,
  connectionState,
  currentProfileId,
  connect,
  disconnect,
  reconnect,
  getDecryptedPassword,
}: AutoConnectParams): void {
  const hasAttemptedAutoConnect = useRef(false);
  const lastProfileId = useRef<string | null>(null);

  // Reset auto-connect flag when notifications are disabled
  useEffect(() => {
    if (!settings?.enabled) {
      hasAttemptedAutoConnect.current = false;
    }
  }, [settings?.enabled]);

  // Reset auto-connect flag when notification mode changes
  useEffect(() => {
    hasAttemptedAutoConnect.current = false;
  }, [settings?.notificationMode]);

  // Handle profile switching: disconnect from previous profile
  useEffect(() => {
    if (currentProfile?.id !== lastProfileId.current) {
      lastProfileId.current = currentProfile?.id || null;
      hasAttemptedAutoConnect.current = false;

      // Disconnect from previous profile if connected to a different one
      if (isConnected && currentProfileId !== currentProfile?.id) {
        log.notifications('Profile changed - disconnecting from previous profile', LogLevel.INFO, { previousProfile: currentProfileId,
          newProfile: currentProfile?.id, });
        disconnect();
      }
    }
  }, [currentProfile?.id, isConnected, currentProfileId, disconnect]);

  // Auto-connect when profile loads (if enabled)
  // In ES mode: connects websocket. In Direct mode on desktop: starts event poller.
  useEffect(() => {
    if (
      !settings?.enabled ||
      !currentProfile ||
      !currentProfile.username ||
      !currentProfile.password ||
      hasAttemptedAutoConnect.current
    ) {
      return;
    }

    const mode = settings.notificationMode || 'es';

    if (mode === 'direct') {
      if (Platform.isDesktopOrWeb) {
        // Desktop (Electron) or web browser: start event poller.
        // The poller's start() emits its own "Starting event poller" log,
        // so we don't duplicate it here.
        hasAttemptedAutoConnect.current = true;
        startEventPoller(currentProfile.id);
      }
      // Native mobile (iOS/Android): push notifications handle everything via FCM
      return;
    }

    // ES mode: auto-connect websocket (existing behavior)
    if (
      !settings.host ||
      isConnected ||
      connectionState !== 'disconnected'
    ) {
      return;
    }

    hasAttemptedAutoConnect.current = true;

    log.notifications('Auto-connecting to notification server', LogLevel.INFO, { profileId: currentProfile.id, });

    const attemptConnect = async () => {
      try {
        const password = await getDecryptedPassword(currentProfile.id);

        // Check state again right before connecting to avoid race conditions
        // This is crucial because getDecryptedPassword is async and state might have changed
        const currentState = useNotificationStore.getState().connectionState;
        if (currentState !== 'disconnected') {
           log.notifications('Skipping auto-connect - already connected or connecting', LogLevel.INFO, { state: currentState,
             profileId: currentProfile.id, });
           return;
        }

        if (password) {
          await connect(currentProfile.id, currentProfile.username!, password, currentProfile.portalUrl);
          log.notifications('Auto-connected to notification server', LogLevel.INFO, { profileId: currentProfile.id, });
        } else {
          log.notifications('Auto-connect failed - could not decrypt password', LogLevel.ERROR, {
            profileId: currentProfile.id,
          });
        }
      } catch (error) {
        // The service handles reconnection internally via exponential backoff
        log.notifications('Auto-connect failed, service will retry automatically', LogLevel.ERROR, {
          profileId: currentProfile.id,
          error,
        });
      }
    };

    // Small delay to ensure store initialization is complete
    setTimeout(() => attemptConnect(), NOTIFICATIONS_SERVICE.autoConnectInitDelayMs);
  }, [settings?.enabled, settings?.notificationMode, settings?.host, isConnected, connectionState, currentProfile, connect, getDecryptedPassword]);

  // Stop event poller on cleanup or when mode/profile changes
  useEffect(() => {
    return () => {
      const poller = getEventPoller();
      if (poller.isRunning()) {
        poller.stop();
      }
    };
  }, [currentProfile?.id, settings?.notificationMode, settings?.enabled]);

  // Gate for the ES-mode listeners below. Recomputed each render; the
  // listener hooks re-register only when the resulting boolean changes.
  const esModeEnabled = !!settings?.enabled && (settings?.notificationMode || 'es') === 'es';

  // Network change listener: reconnect when connectivity is restored
  useEffect(() => {
    if (!esModeEnabled) return;

    const handleOnline = () => {
      log.notificationHandler('Network restored, triggering reconnect', LogLevel.INFO);
      reconnect();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [esModeEnabled, reconnect]);

  // On native platforms, also use Capacitor's Network plugin for faster detection
  useCapacitorListener(
    () => import('@capacitor/network').then((m) => m.Network),
    'networkStatusChange',
    (status: { connected: boolean }) => {
      if (status.connected) {
        log.notificationHandler('Native network restored, triggering reconnect', LogLevel.INFO);
        reconnect();
      }
    },
    { enabled: Platform.isNative && esModeEnabled },
  );

  // Visibility change listener (desktop/web): check liveness when tab becomes visible
  useEffect(() => {
    const mode = settings?.notificationMode || 'es';
    if (!settings?.enabled || mode !== 'es' || Platform.isNative) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!isConnected) return;

      log.notificationHandler('Tab visible, checking WebSocket liveness', LogLevel.DEBUG);
      const service = getNotificationService();
      const alive = await service.checkAlive(5000);

      if (!alive) {
        log.notificationHandler('WebSocket not responding after tab resume, reconnecting', LogLevel.WARN);
        reconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [settings?.enabled, settings?.notificationMode, isConnected, reconnect]);

  // App resume liveness check (mobile): verify WebSocket is alive when app returns to foreground
  useCapacitorListener(
    () => import('@capacitor/app').then((m) => m.App),
    'appStateChange',
    async ({ isActive }: { isActive: boolean }) => {
      if (!isActive || !isConnected) return;

      log.notificationHandler('App resumed, checking WebSocket liveness', LogLevel.DEBUG);
      const service = getNotificationService();
      const alive = await service.checkAlive(5000);

      if (!alive) {
        log.notificationHandler('WebSocket not responding after app resume, reconnecting', LogLevel.WARN);
        reconnect();
      }
    },
    {
      enabled: Platform.isNative && esModeEnabled,
      onError: (e) => log.notificationHandler('Failed to setup app resume liveness check', LogLevel.ERROR, e),
    },
  );
}
