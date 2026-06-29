/**
 * Global keyboard shortcut definitions and pure helpers (refs #200).
 *
 * The wiring (listener, navigation, numeric buffer, help overlay) lives in
 * components/KeyboardShortcuts.tsx; the data and decisions are kept here so they
 * can be unit-tested without the DOM.
 */

export interface NavShortcut {
  key: string;
  route: string;
  /** i18n key for the human label (reuses the sidebar labels). */
  labelKey: string;
}

/** Single-key navigation shortcuts, one per top-level menu destination. */
export const NAV_SHORTCUTS: NavShortcut[] = [
  { key: 'd', route: '/dashboard', labelKey: 'sidebar.dashboard' },
  { key: 'm', route: '/montage', labelKey: 'sidebar.montage' },
  { key: 'e', route: '/events', labelKey: 'sidebar.events' },
  { key: 'v', route: '/monitors', labelKey: 'sidebar.monitors' },
  { key: 't', route: '/timeline', labelKey: 'sidebar.timeline' },
  { key: 'n', route: '/notifications', labelKey: 'sidebar.notifications' },
  { key: 'l', route: '/logs', labelKey: 'sidebar.logs' },
  { key: 'g', route: '/settings', labelKey: 'sidebar.settings' },
  { key: 'p', route: '/profiles', labelKey: 'sidebar.profiles' },
  { key: 'r', route: '/server', labelKey: 'sidebar.server' },
];

/** Route for a navigation key, or null. Case-insensitive. */
export function routeForKey(key: string): string | null {
  const match = NAV_SHORTCUTS.find((s) => s.key === key.toLowerCase());
  return match ? match.route : null;
}

/** True when the event target is a text-entry element, so shortcuts must defer. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

/**
 * Convert a buffered monitor number to a 0-based index into the monitor list,
 * or null when it is out of range. `count` is the number of monitors.
 */
export function monitorIndexFromBuffer(buffer: string, count: number): number | null {
  if (!/^\d+$/.test(buffer)) return null;
  const n = parseInt(buffer, 10);
  if (n < 1 || n > count) return null;
  return n - 1;
}
