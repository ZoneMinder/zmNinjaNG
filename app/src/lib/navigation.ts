/**
 * Navigation Service
 *
 * Provides a way for non-React code (like services) to trigger navigation
 * events that can be handled by React components with access to the router.
 */

import { log, LogLevel } from './logger';
import { ALL_PROFILES_ID, type ProfileId } from '../api/types';

export interface NavigationState {
  from?: string;
  fromNotification?: boolean;
  [key: string]: unknown;
}

export interface NavigationEvent {
  path: string;
  replace?: boolean;
  state?: NavigationState;
}

type NavigationListener = (event: NavigationEvent) => void;

class NavigationService {
  private listeners: NavigationListener[] = [];

  /**
   * Navigate to a path
   */
  public navigate(path: string, replace = false, state?: NavigationState): void {
    log.navigation('Navigation requested', LogLevel.INFO, { path, replace });

    const event: NavigationEvent = { path, replace, state };
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.navigation('Navigation listener error', LogLevel.ERROR, { path, error });
      }
    });
  }

  /**
   * Navigate to event detail page. When profileId is given, routes through
   * the /all/ deep route so the page resolves its session from that owning
   * profile instead of the (possibly absent) current one - used for All-mode
   * notification taps (refs #337).
   */
  public navigateToEvent(eventId: string | number, state?: NavigationState, profileId?: string): void {
    const path = profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`;
    this.navigate(path, false, state);
  }

  /**
   * Navigate to monitor detail page
   */
  public navigateToMonitor(monitorId: string | number): void {
    this.navigate(`/monitors/${monitorId}`);
  }

  /**
   * Add a navigation listener
   * @returns Cleanup function to remove the listener
   */
  public addListener(listener: NavigationListener): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Remove all listeners (useful for cleanup)
   */
  public removeAllListeners(): void {
    this.listeners = [];
  }
}

// Singleton instance
export const navigationService = new NavigationService();

/**
 * Map a pathname to the human-readable view name used in entry banners
 * and any other place that wants to refer to the current page in plain
 * language. Returns null for paths that shouldn't emit a banner (the
 * setup flow, transient redirects).
 */
export function viewNameForPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  const exact: Record<string, string> = {
    '/': 'Home',
    '/dashboard': 'Dashboard',
    '/monitors': 'Monitors',
    '/montage': 'Montage',
    '/live-activity': 'Live Activity',
    '/events': 'Events',
    '/event-montage': 'Event Montage',
    '/timeline': 'Timeline',
    '/notifications': 'Notifications',
    '/notification-settings': 'Notification Settings',
    '/notification-history': 'Notification History',
    '/server': 'Server',
    '/profiles': 'Profiles',
    '/settings': 'Settings',
    '/logs': 'Logs',
    '/kiosk': 'Kiosk',
  };
  if (path in exact) return exact[path];

  // Setup-flow paths suppress the banner: they're transient and not "views".
  if (path === '/setup' || path === '/profiles/new') return null;

  if (/^\/monitors\/[^/]+$/.test(path)) return 'Monitor Detail';
  if (/^\/events\/[^/]+$/.test(path)) return 'Event Detail';
  if (/^\/profiles\/[^/]+\/edit$/.test(path)) return 'Profile Form';

  // All-mode deep routes: /all/monitors/:profileId/:id and /all/events/:profileId/:id
  // (see App.tsx's routes) name the same view as their single-mode counterparts,
  // so opening one from a notification or card still fires the entry banner (refs #337).
  if (/^\/all\/monitors\/[^/]+\/[^/]+$/.test(path)) return 'Monitor Detail';
  if (/^\/all\/events\/[^/]+\/[^/]+$/.test(path)) return 'Event Detail';

  return null;
}

/**
 * Which settings bucket (if any) AppLayout's route-memory effect should save
 * `pathname` into, so the app reopens on the last page visited.
 *
 * All mode saves to the shared ALL bucket rather than being silently
 * dropped: `currentProfile` is null there (useCurrentProfile resolves it to
 * null for the ALL_PROFILES_ID sentinel), so a guard keyed off
 * `currentProfile?.id` never fired and no page was ever remembered while
 * aggregating (refs #337). Returns null - meaning "don't save" - for the
 * setup/profile routes, a notification-opened page, or when there is
 * genuinely no profile selected yet.
 */
export function resolveLastRouteSaveTarget(
  pathname: string,
  fromNotification: boolean,
  isAllMode: boolean,
  currentProfileId: ProfileId | undefined
): ProfileId | null {
  const excludedRoutes = ['/profiles/new', '/setup', '/profiles'];
  if (excludedRoutes.includes(pathname) || fromNotification) return null;
  if (isAllMode) return ALL_PROFILES_ID;
  return currentProfileId ?? null;
}
