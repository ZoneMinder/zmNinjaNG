/**
 * React Query key factory.
 *
 * Every server-data query is scoped to the active ZoneMinder profile by putting
 * the profile id immediately after the domain name: `[domain, profileId, ...rest]`.
 * React Query invalidates by array prefix, so a domain-level key (just
 * `[domain, profileId]`) prefix-matches every leaf key in that domain. Keep the
 * profileId in the same position across a domain and never insert an optional
 * parameter before it, or prefix invalidation stops matching.
 *
 * The global `queryClient.clear()` on profile switch (stores/query-cache.ts) is
 * the primary cross-profile safety net. These profile-scoped keys are
 * defense-in-depth so a stale key from another profile can never match.
 *
 * A handful of keys are genuinely app-level (not tied to a profile/server) and
 * carry no profile id. They are grouped at the bottom.
 */

/** Profile id as supplied by the various call sites (hook, store, or prop). */
type ProfileId = string | null | undefined;

export const queryKeys = {
  // --- Monitors -----------------------------------------------------------
  /** All monitor-derived queries. Domain prefix for broad invalidation. */
  monitors: (profileId: ProfileId) => ['monitors', profileId] as const,
  /** Full monitor list including excluded monitors (settings screen). */
  monitorsAllIncludingExcluded: (profileId: ProfileId) =>
    ['monitors', profileId, 'all-including-excluded'] as const,
  /** A single monitor by id. */
  monitor: (profileId: ProfileId, monitorId: string | undefined) =>
    ['monitor', profileId, monitorId] as const,
  /** Live alarm status for a monitor. */
  monitorAlarmStatus: (profileId: ProfileId, monitorId: string | undefined) =>
    ['monitor-alarm-status', profileId, monitorId] as const,
  /** PTZ control capabilities for a monitor's control id. */
  control: (profileId: ProfileId, controlId: string | null | undefined) =>
    ['control', profileId, controlId] as const,
  /** Zones for a monitor. */
  zones: (profileId: ProfileId, monitorId: string | undefined) =>
    ['zones', profileId, monitorId] as const,

  // --- Groups / tags ------------------------------------------------------
  groups: (profileId: ProfileId) => ['groups', profileId] as const,
  tags: (profileId: ProfileId) => ['tags', profileId] as const,
  eventTags: (profileId: ProfileId, sortedEventIds: string[]) =>
    ['eventTags', profileId, sortedEventIds] as const,

  // --- Events -------------------------------------------------------------
  /** All `events`-domain queries. Domain prefix for broad invalidation. */
  events: (profileId: ProfileId) => ['events', profileId] as const,
  /** The main events list on the Events page. */
  eventsList: (
    profileId: ProfileId,
    filters: unknown,
    limit: number,
    monitorId: string | undefined,
    isGroupFilterActive: boolean,
    eventIds: string[] | undefined,
    tagIds: string[] | undefined,
  ) =>
    [
      'events',
      profileId,
      filters,
      limit,
      monitorId,
      isGroupFilterActive,
      eventIds,
      tagIds,
    ] as const,
  /** Events list shown inside a dashboard events widget. */
  eventsWidget: (
    profileId: ProfileId,
    monitorIdFilter: string | undefined,
    limit: number,
    onlyDetectedObjects: boolean,
  ) => ['events', profileId, monitorIdFilter, limit, onlyDetectedObjects] as const,
  /** Events feeding the dashboard timeline widget. */
  eventsTimelineWidget: (profileId: ProfileId, startMs: number) =>
    ['events', profileId, 'timeline-widget', startMs] as const,
  /** A single event by id. */
  event: (profileId: ProfileId, eventId: string | undefined) =>
    ['event', profileId, eventId] as const,
  /** Recent events for a single monitor (monitor detail list). */
  monitorRecentEvents: (
    profileId: ProfileId,
    monitorId: string,
    count: number,
  ) => ['monitorRecentEvents', profileId, monitorId, count] as const,
  /** Events aggregated for the dashboard heatmap widget. */
  eventsHeatmap: (profileId: ProfileId, timeRange: string) =>
    ['events-heatmap', profileId, timeRange] as const,
  /** All `event-montage`-domain queries. Domain prefix for invalidation. */
  eventMontage: (profileId: ProfileId) => ['event-montage', profileId] as const,
  /** Events for the event montage page. */
  eventMontageList: (profileId: ProfileId, filterParams: unknown) =>
    ['event-montage', profileId, filterParams] as const,
  /** All `consoleEvents`-domain queries. Domain prefix for invalidation. */
  consoleEvents: (profileId: ProfileId) => ['consoleEvents', profileId] as const,
  /** Per-monitor event counts for the monitors console. */
  consoleEventsList: (profileId: ProfileId, range: string) =>
    ['consoleEvents', profileId, range] as const,
  /** All `timeline-events`-domain queries. Domain prefix for invalidation. */
  timelineEvents: (profileId: ProfileId) => ['timeline-events', profileId] as const,
  /** Events for the timeline page (optionally fanned out per monitor). */
  timelineEventsList: (
    profileId: ProfileId,
    startDate: string,
    endDate: string,
    monitorFilter: string | undefined,
    onlyDetectedObjects: boolean,
    causeFilter: string,
  ) =>
    [
      'timeline-events',
      profileId,
      startDate,
      endDate,
      monitorFilter,
      onlyDetectedObjects,
      causeFilter,
    ] as const,

  // --- Server / system ----------------------------------------------------
  servers: (profileId: ProfileId) => ['servers', profileId] as const,
  daemonCheck: (profileId: ProfileId) => ['daemon-check', profileId] as const,
  serverLoad: (profileId: ProfileId) => ['server-load', profileId] as const,
  diskUsage: (profileId: ProfileId) => ['disk-usage', profileId] as const,
  states: (profileId: ProfileId) => ['states', profileId] as const,
  timezone: (profileId: ProfileId) => ['timezone', profileId] as const,
  storages: (profileId: ProfileId) => ['storages', profileId] as const,

  // --- App-level (not profile-scoped) -------------------------------------
  /** In-app developer notices. App-level, identical across profiles. */
  developerNotices: () => ['developer-notices'] as const,
} as const;
