/**
 * useNetworkStatus Hook
 *
 * Tracks browser/device network connectivity for the app-wide offline banner
 * (see AppLayout.tsx). On native platforms (iOS/Android) it uses Capacitor's
 * Network plugin, loaded dynamically and gated on Platform.isNative per rule
 * 14. On web/desktop it falls back to `navigator.onLine` plus the
 * `online`/`offline` window events.
 *
 * The native effect fetches the current status once (so the banner doesn't
 * wait for the first transition) and then registers the change listener,
 * both through a single `import('@capacitor/network')` call. Two separate
 * dynamic imports of the same plugin from two effects on the same mount is
 * unnecessary and, under Vitest's module mocking, races; one shared import
 * sidesteps that.
 *
 * This is presentation-only: it does not touch the WebSocket/event-poller
 * reconnect logic in useNotificationAutoConnect.ts, which already listens for
 * the same browser/native connectivity signals to trigger a reconnect.
 */

import { useEffect, useState } from 'react';
import { Platform } from '../lib/platform';

function getInitialOnlineState(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export interface UseNetworkStatusReturn {
  /** False while the device/browser has no network connectivity. */
  isOnline: boolean;
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const [isOnline, setIsOnline] = useState<boolean>(getInitialOnlineState);

  // Web/desktop: standard browser connectivity events.
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Native: read the current status once, then subscribe to transitions.
  useEffect(() => {
    if (!Platform.isNative) return;

    let cancelled = false;
    let handle: { remove(): void | Promise<void> } | undefined;

    (async () => {
      try {
        const { Network } = await import('@capacitor/network');

        const status = await Network.getStatus();
        if (cancelled) return;
        setIsOnline(status.connected);

        const resolved = await Network.addListener('networkStatusChange', (s: { connected: boolean }) => {
          setIsOnline(s.connected);
        });
        if (cancelled) {
          void resolved.remove();
        } else {
          handle = resolved;
        }
      } catch {
        // Network plugin unavailable; the browser online/offline listeners
        // above still cover us.
      }
    })();

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, []);

  return { isOnline };
}
