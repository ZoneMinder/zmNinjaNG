/**
 * Android Hardware Back Button
 *
 * Without a handler the Android back gesture only walks the WebView history and
 * never leaves the app (refs #192). This registers a single global handler that:
 * - closes an open dialog/popover first,
 * - on a detail view, navigates back to its parent,
 * - on a root (menu) view, shows "press back again to exit" and exits on a
 *   second press within a short window.
 *
 * Native Android only. Disabled while the kiosk lock is engaged so the kiosk's
 * own back-swallowing handler stays in control.
 */

import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Platform } from '../lib/platform';
import { useKioskStore } from '../stores/kioskStore';
import { useCapacitorListener } from './useCapacitorListener';
import { ANDROID_BACK } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

/** Top-level menu destinations. Back here confirms/exits rather than navigating. */
const ROOT_ROUTES = [
  '/dashboard',
  '/monitors',
  '/montage',
  '/events',
  '/timeline',
  '/notifications',
  '/profiles',
  '/settings',
  '/server',
  '/logs',
  '/developer-notice',
];

export type BackAction = 'close-overlay' | 'navigate-back' | 'confirm-exit' | 'exit';

export function isRootRoute(pathname: string): boolean {
  return ROOT_ROUTES.includes(pathname);
}

/**
 * Pure decision for what the back button should do. Kept separate from the hook
 * so the branching is unit-testable without Capacitor or the DOM.
 */
export function decideBackAction(params: {
  hasOpenOverlay: boolean;
  isRootRoute: boolean;
  doubleTapActive: boolean;
}): BackAction {
  if (params.hasOpenOverlay) return 'close-overlay';
  if (!params.isRootRoute) return 'navigate-back';
  return params.doubleTapActive ? 'exit' : 'confirm-exit';
}

/** True when a Radix dialog/alert-dialog or a popper (popover/dropdown/select) is open. */
function hasOpenOverlay(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]'
  );
}

export function useAndroidBackButton(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isLocked = useKioskStore((state) => state.isLocked);
  const lastBackRef = useRef(0);

  const handleBack = useCallback(async () => {
    const now = Date.now();
    const action = decideBackAction({
      hasOpenOverlay: hasOpenOverlay(),
      isRootRoute: isRootRoute(location.pathname),
      doubleTapActive: now - lastBackRef.current < ANDROID_BACK.exitConfirmWindowMs,
    });

    switch (action) {
      case 'close-overlay':
        // Let the overlay's own Escape handling close the topmost layer.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      case 'navigate-back':
        navigate(-1);
        return;
      case 'confirm-exit':
        lastBackRef.current = now;
        toast(t('common.press_back_again_to_exit'));
        return;
      case 'exit':
        try {
          const { App } = await import('@capacitor/app');
          await App.exitApp();
        } catch (error) {
          log.app('exitApp failed', LogLevel.WARN, { error });
        }
        return;
    }
  }, [navigate, location.pathname, t]);

  useCapacitorListener(
    () => import('@capacitor/app').then((m) => m.App),
    'backButton',
    handleBack,
    { enabled: Platform.isNative && !isLocked },
  );
}
