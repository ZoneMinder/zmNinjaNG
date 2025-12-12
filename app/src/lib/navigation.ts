/**
 * Navigation Service
 *
 * Provides a way for non-React code (like services) to trigger navigation
 * events that can be handled by React components with access to the router.
 */

import { log } from './logger';

export interface NavigationEvent {
  path: string;
  replace?: boolean;
}

type NavigationListener = (event: NavigationEvent) => void;

class NavigationService {
  private listeners: NavigationListener[] = [];

  /**
   * Navigate to a path
   */
  public navigate(path: string, replace = false): void {
    log.info('Navigation requested', { component: 'Navigation', path, replace });

    const event: NavigationEvent = { path, replace };
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.error('Navigation listener error', { component: 'Navigation', path }, error);
      }
    });
  }

  /**
   * Navigate to event detail page
   */
  public navigateToEvent(eventId: string | number): void {
    this.navigate(`/events/${eventId}`);
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
