/**
 * Mirror native iOS safe-area insets into CSS custom properties.
 *
 * iOS WKWebView + Capacitor 7 with contentInset='never' + viewport-fit=cover
 * reports stale or wrong env(safe-area-inset-*) values across rotations
 * (see #147 diagnostic: env(top) stays 0 in portrait on Dynamic Island
 * devices, env(left/right) stay at landscape 62 values regardless of
 * orientation). The native SafeAreaPlugin reads UIView.safeAreaInsets
 * (UIKit's source of truth) and emits an event on every change. Here we
 * apply those values to --sai-top/right/bottom/left on the document root.
 *
 * CSS usages reference var(--sai-top, ...). On iOS the inline values set here
 * win. On Android this plugin is a no-op: env(safe-area-inset-*) is NOT
 * reliable there (0 on WebView < 140, and observed 0 even on Android 16 with
 * enforced edge-to-edge). Capacitor 8's core SystemBars plugin instead injects
 * --safe-area-inset-* inline on documentElement; the :root rule in index.css
 * chains --sai-* -> --safe-area-inset-* -> env() so every consumer picks up
 * whichever source is live on the current platform.
 */

import { Capacitor } from '@capacitor/core';
import { log, LogLevel } from './logger';
import type { SafeAreaInsets } from '../plugins/safe-area';

let lastAppliedKey: string | null = null;

function applyInsets(insets: SafeAreaInsets, source: string): void {
  const root = document.documentElement;
  root.style.setProperty('--sai-top', `${insets.top}px`);
  root.style.setProperty('--sai-right', `${insets.right}px`);
  root.style.setProperty('--sai-bottom', `${insets.bottom}px`);
  root.style.setProperty('--sai-left', `${insets.left}px`);

  // The native plugin re-emits on every foreground (applicationDidBecomeActive),
  // so the values are usually unchanged. Only log when they actually differ to
  // avoid flooding the log on each app resume.
  const key = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
  if (key !== lastAppliedKey) {
    lastAppliedKey = key;
    log.app(`[SafeArea] applied (${source})`, LogLevel.INFO, insets);
  }
}

export async function installSafeAreaBootstrap(): Promise<void> {
  // Only iOS has the env() reporting bug. On Android and web, env() works
  // correctly so the var()-with-env-fallback in CSS resolves to env() and
  // nothing more is needed.
  if (Capacitor.getPlatform() !== 'ios') return;

  const { SafeArea } = await import('../plugins/safe-area');

  // Seed once at startup. The native plugin also emits an initial event
  // on load(), so this is belt-and-suspenders for the first paint.
  try {
    const insets = await SafeArea.getInsets();
    applyInsets(insets, 'initial-getInsets');
  } catch (error) {
    log.app('[SafeArea] initial getInsets failed', LogLevel.WARN, error);
  }

  await SafeArea.addListener('safeAreaInsetsChanged', (insets) =>
    applyInsets(insets, 'event'),
  );
}
