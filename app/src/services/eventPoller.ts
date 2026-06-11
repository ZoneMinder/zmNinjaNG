/**
 * Event Poller Service
 *
 * Polls the ZM events API for new events in Direct notification mode on desktop (Electron) and web.
 * New events are fed into the notification store, which triggers the existing
 * sonner toast display via NotificationHandler.
 *
 * The poller has no zustand imports. Store-derived values (event sink, auth
 * token, poll interval, portal URL) are injected via EventPollerDeps, which
 * `startEventPoller` in stores/notifications.ts assembles.
 */

import { getEvents, getEventImageUrl } from '../api/events';
import type { EventFilters } from '../api/events';
import { getMonitors } from '../api/monitors';
import { getPortalUrlForEvent } from '../lib/server-resolver';
import { NOTIFICATIONS_SERVICE } from '../lib/zmninja-ng-constants';
import type { ZMAlarmEvent } from '../types/notifications';
import { log, LogLevel } from '../lib/logger';

/**
 * Store-derived values injected into the poller at start time.
 */
export interface EventPollerDeps {
  /** Receives each newly detected event (the caller assigns profile and source). */
  onEvent: (event: ZMAlarmEvent) => void;
  /** Notification setting: restrict polling to object-detection events. */
  getOnlyDetectedEvents: () => boolean;
  /** Returns a fresh ZM access token for image URLs, or null when unavailable. */
  getFreshAccessToken: () => Promise<string | null>;
  /** Poll interval in milliseconds (bandwidth-mode aware). */
  getPollIntervalMs: () => number;
  /** Portal URL of the connected profile, or undefined when unavailable. */
  getPortalUrl: () => string | undefined;
  /** Effective multi-port streaming base port, or undefined when disabled. */
  getMinStreamingPort: () => number | undefined;
}

function parseEventId(id: string | number): number {
  return parseInt(String(id), 10);
}

class EventPollerService {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private profileId: string | null = null;
  private deps: EventPollerDeps | null = null;
  private seenEventIds = new Set<number>();
  private isFirstPoll = true;
  private monitorNames = new Map<string, string>();
  private monitorData: Array<{ Monitor: { Id: string; ServerId: string | null } }> = [];

  /**
   * Start polling for new events.
   * Loads monitor names first, then begins the poll cycle.
   */
  async start(profileId: string, deps: EventPollerDeps): Promise<void> {
    // Idempotent for the same profile: a duplicate start() call is a no-op
    // rather than a stop/restart. A different profile *does* tear down and
    // re-init.
    if (this.timerId && this.profileId === profileId) {
      log.notifications('Event poller already running: skipping duplicate start', LogLevel.DEBUG, { profileId });
      return;
    }
    if (this.timerId) {
      this.stop();
    }

    this.profileId = profileId;
    this.deps = deps;
    this.seenEventIds.clear();
    this.isFirstPoll = true;

    log.notifications('Starting event poller for direct mode', LogLevel.INFO, { profileId });

    // Load monitor names before first poll so events have real names
    await this._loadMonitorNames();
    this._pollAndSchedule();
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.profileId = null;
    this.deps = null;
    this.seenEventIds.clear();
    this.isFirstPoll = true;
    this.monitorNames.clear();
    this.monitorData = [];

    log.notifications('Stopped event poller', LogLevel.INFO);
  }

  /**
   * Check if the poller is running.
   */
  isRunning(): boolean {
    return this.timerId !== null;
  }

  private async _loadMonitorNames(): Promise<void> {
    try {
      const result = await getMonitors();
      this.monitorNames.clear();
      this.monitorData = result.monitors.map((m) => ({
        Monitor: { Id: m.Monitor.Id, ServerId: m.Monitor.ServerId ?? null },
      }));
      for (const m of result.monitors) {
        this.monitorNames.set(m.Monitor.Id, m.Monitor.Name);
      }
      log.notifications('Event poller loaded monitor names', LogLevel.DEBUG, {
        count: this.monitorNames.size,
      });
    } catch (error) {
      log.notifications('Event poller failed to load monitor names', LogLevel.WARN, error);
    }
  }

  private _pollAndSchedule(): void {
    if (!this.profileId) return;

    this._poll().finally(() => {
      // Schedule next poll only if still running (not stopped during _poll)
      if (this.profileId && this.deps) {
        this.timerId = setTimeout(() => this._pollAndSchedule(), this.deps.getPollIntervalMs());
      }
    });
  }

  private async _poll(): Promise<void> {
    const deps = this.deps;
    if (!this.profileId || !deps) return;

    try {
      const filters: EventFilters = {
        limit: 5,
        sort: 'StartDateTime',
        direction: 'desc',
      };
      if (deps.getOnlyDetectedEvents()) {
        filters.notesRegexp = 'detected:';
      }

      const result = await getEvents(filters);
      const events = result.events || [];

      if (this.isFirstPoll) {
        // Seed the seen set without triggering notifications
        for (const event of events) {
          this.seenEventIds.add(parseEventId(event.Event.Id));
        }
        this.isFirstPoll = false;
        log.notifications('Event poller seeded with existing events', LogLevel.DEBUG, {
          count: events.length,
        });
        return;
      }

      const portalUrl = deps.getPortalUrl();
      const accessToken = await deps.getFreshAccessToken();

      for (const event of events) {
        const eventId = parseEventId(event.Event.Id);
        if (this.seenEventIds.has(eventId)) continue;

        this.seenEventIds.add(eventId);

        const monitorId = parseEventId(event.Event.MonitorId);
        const monitorName = this.monitorNames.get(String(event.Event.MonitorId)) || `Monitor ${monitorId}`;
        const cause = event.Event.Cause || 'Motion';

        const eventPortalUrl = portalUrl
          ? getPortalUrlForEvent(String(event.Event.MonitorId), this.monitorData, portalUrl)
          : undefined;
        const imageUrl = eventPortalUrl && accessToken
          ? getEventImageUrl(eventPortalUrl, String(eventId), 'snapshot', {
              token: accessToken,
              width: NOTIFICATIONS_SERVICE.snapshotImageWidth,
              minStreamingPort: deps.getMinStreamingPort(),
              monitorId: String(event.Event.MonitorId),
            })
          : undefined;

        log.notifications('Event poller found new event', LogLevel.INFO, {
          eventId, monitorName, cause,
        });

        deps.onEvent({
          MonitorId: monitorId,
          MonitorName: monitorName,
          EventId: eventId,
          Cause: cause,
          Name: monitorName,
          Notes: event.Event.Notes || undefined,
          ImageUrl: imageUrl,
        });
      }

      // Prevent unbounded growth of seen set
      if (this.seenEventIds.size > 500) {
        this.seenEventIds = new Set(events.map(e => parseEventId(e.Event.Id)));
      }
    } catch (error) {
      // Non-blocking: the next scheduled poll retries
      log.notifications('Event poller failed', LogLevel.WARN, error);
    }
  }
}

// Singleton
let eventPoller: EventPollerService | null = null;

export function getEventPoller(): EventPollerService {
  if (!eventPoller) {
    eventPoller = new EventPollerService();
  }
  return eventPoller;
}
