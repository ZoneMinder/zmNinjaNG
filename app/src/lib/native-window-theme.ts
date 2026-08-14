import { registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Platform } from './platform';
import { log, LogLevel } from './logger';

interface WindowThemePluginInterface {
  setBackgroundColor(options: { color: string }): Promise<void>;
}

const WindowTheme = registerPlugin<WindowThemePluginInterface>('WindowTheme');

function rgbStringToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function syncNativeWindowBackground(): void {
  if (!Platform.isAndroid) return;
  if (typeof window === 'undefined') return;

  const computed = getComputedStyle(window.document.documentElement).backgroundColor;
  const hex = rgbStringToHex(computed);
  if (!hex) {
    log.app('Could not parse theme background color', LogLevel.WARN, { computed });
    return;
  }

  WindowTheme.setBackgroundColor({ color: hex }).catch((err: unknown) => {
    log.app('Failed to set native window background', LogLevel.WARN, { hex, err });
  });
}

/**
 * Keeps Android status/navigation bar icon color readable against the app
 * theme. Must go through the SystemBars plugin, not the insets controller
 * directly: SystemBars re-applies its own tracked style on every
 * configuration change (rotation), so a direct controller call is stomped
 * back to DEFAULT, which follows the OS theme. With a light OS theme and a
 * dark app theme that re-apply requests dark icons on a dark background
 * (refs #356). setStyle updates the tracked style, so re-applies preserve
 * it. Must run on every effective theme change, including the "system"
 * branch: an explicitly set style never reverts to DEFAULT on its own.
 * iOS is left on its existing default pending a device pass.
 */
export function syncNativeSystemBarsStyle(): void {
  if (!Platform.isAndroid) return;
  if (typeof document === 'undefined') return;

  const dark = document.documentElement.classList.contains('dark');
  const style = dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
  SystemBars.setStyle({ style }).catch((err: unknown) => {
    log.app('Failed to set system bars style', LogLevel.WARN, { style, err });
  });
}
