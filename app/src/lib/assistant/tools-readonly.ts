/**
 * Read-only assistant tools (refs #246).
 *
 * Every executor wraps its fetch in `safeExecute` so a failed request turns
 * into `{ output: message, isError: true }` instead of throwing into the
 * agent loop. `navigate` is the one exception: it validates before touching
 * the network and never calls the api layer at all.
 */
import { getMonitors, getMonitor, getAlarmStatus } from '../../api/monitors';
import { getEvents, getEvent, getConsoleEvents } from '../../api/events';
import type { EventFilters } from '../../api/events';
import { getLoad, getDiskPercent, getDaemonCheck, getStorages, getServers } from '../../api/server';
import type { Storage } from '../../api/server';
import { getVersion } from '../../api/auth';
import { getGroups } from '../../api/groups';
import { getTags, getEventTags, extractUniqueTags } from '../../api/tags';
import type { MonitorData } from '../../api/types';
import { ASSISTANT } from '../zmninja-ng-constants';
import { parseDetectedObjects } from '../event/event-detection';
import { buildEventDisplayEntity, buildMonitorDisplayEntity } from './display';
import { EVENT_RANGES, resolveEventRange, isEventRange, type EventRange } from './event-range';
import { resolveMonitorRef } from './monitor-ref';
import type { ToolDefinition } from './types';
import { safeExecute, NAVIGATE_ALLOWLIST } from './tool-helpers';

/** Maps a raw MonitorData into the clean, model-friendly shape shared by
 *  list_monitors and get_monitor (refs #246): '0'/'1' strings become
 *  booleans, Monitor_Status merges in as flat fields, and the ZM 1.38+
 *  Capturing/Analysing/Recording trio is included only when the server
 *  actually sends it (older servers only carry Function). */
function mapMonitor(m: MonitorData): Record<string, unknown> {
  const status = m.Monitor_Status;
  const out: Record<string, unknown> = {
    id: m.Monitor.Id,
    name: m.Monitor.Name,
    type: m.Monitor.Type,
    function: m.Monitor.Function,
    enabled: m.Monitor.Enabled === '1',
    controllable: m.Monitor.Controllable === '1',
    controlId: m.Monitor.ControlId,
    width: Number(m.Monitor.Width),
    height: Number(m.Monitor.Height),
  };
  if (status?.Status != null) out.status = status.Status;
  if (status?.CaptureFPS != null) out.captureFps = Number(status.CaptureFPS);
  if (status?.AnalysisFPS != null) out.analysisFps = Number(status.AnalysisFPS);
  if (m.Monitor.Capturing !== undefined) out.capturing = m.Monitor.Capturing;
  if (m.Monitor.Analysing !== undefined) out.analysing = m.Monitor.Analysing;
  if (m.Monitor.Recording !== undefined) out.recording = m.Monitor.Recording;
  return out;
}

/**
 * Turns a model-supplied `monitorId` (which is often a NAME, see
 * monitor-ref.ts) into a real id, throwing a message the model can retry from.
 *
 * A bare number is passed through without listing monitors first: it is already
 * the right shape, and a wrong one fails loudly at the API rather than becoming
 * an empty result set. `list_events` cannot take that shortcut, since a wrong
 * id there returns zero events and reads exactly like "nothing happened".
 */
async function resolveMonitorArg(raw: unknown): Promise<string> {
  const ref = String(raw ?? '').trim();
  if (!ref) throw new Error('monitorId is required');
  if (/^\d+$/.test(ref)) return ref;
  const { monitors } = await getMonitors();
  const resolution = resolveMonitorRef(ref, monitors);
  if ('error' in resolution) throw new Error(resolution.error);
  return resolution.id;
}

/** Trims a Notes field for the list_events row cap (rule 11: truncate long
 *  text); get_event returns the untrimmed value since it is for one event. */
function trimNotes(notes: string | null, max: number): string | null {
  if (!notes) return notes;
  return notes.length > max ? notes.slice(0, max) : notes;
}

/** Maps a Storage row to disk usage the model can reason about: a percentage
 *  when both used/total are known, otherwise the raw usage figure ZM
 *  reports. Older ZM builds may only send one of the two, or neither. */
function mapStorage(s: Storage): { name: string; diskPercent?: number; usage?: number } {
  if (s.DiskTotalSpace && s.DiskUsedSpace != null && s.DiskTotalSpace > 0) {
    return { name: s.Name, diskPercent: Math.round((s.DiskUsedSpace / s.DiskTotalSpace) * 100) };
  }
  if (s.DiskSpace != null) {
    return { name: s.Name, usage: s.DiskSpace };
  }
  return { name: s.Name };
}

const listMonitorsTool: ToolDefinition = {
  name: 'list_monitors',
  description:
    'List all monitors visible in the current profile: id, name, type, function, enabled/controllable ' +
    'flags, and live status (connection state, capture/analysis fps when available). Call this first when ' +
    'the user refers to a monitor by name, or to answer "what monitors are configured".',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  destructive: false,
  execute: (_input, _ctx) =>
    safeExecute('list_monitors', async () => {
      const { monitors } = await getMonitors();
      return { output: JSON.stringify(monitors.map(mapMonitor)), display: monitors.map(buildMonitorDisplayEntity) };
    }),
};

const getMonitorTool: ToolDefinition = {
  name: 'get_monitor',
  description:
    'Get full detail plus live alarm status for one monitor, including its control capability ' +
    '(controllable, controlId). Call this after list_monitors has resolved the name to an id, when the ' +
    'user asks about a specific monitor\'s current state.',
  schema: {
    type: 'object',
    properties: {
      monitorId: {
        type: 'string',
        description: 'A monitor id from list_monitors. A monitor name ("Front Door") also works.',
      },
    },
    required: ['monitorId'],
  },
  destructive: false,
  execute: (input, _ctx) =>
    safeExecute('get_monitor', async () => {
      const monitorId = await resolveMonitorArg(input.monitorId);
      const [monitor, alarm] = await Promise.all([getMonitor(monitorId), getAlarmStatus(monitorId)]);
      return {
        output: JSON.stringify({
          ...mapMonitor(monitor),
          alarm: { status: alarm.status, output: alarm.output },
        }),
        display: [buildMonitorDisplayEntity(monitor)],
      };
    }),
};

const countEventsTool: ToolDefinition = {
  name: 'count_events',
  description:
    'Count events per monitor over a ROLLING interval ending now, such as "1 hour" or "1 day" (that means ' +
    'the last 24 hours, NOT since local midnight), covering ALL monitors in one call (no monitorId needed) ' +
    'and reporting the combined total. Use this for "how many events in the last N hours/days" or ' +
    '"summarize recent events" questions instead of list_events, which returns individual rows. This tool ' +
    'CANNOT express a calendar day: for "today" (since local midnight) or "yesterday", call list_events ' +
    'with range instead.',
  schema: {
    type: 'object',
    properties: { interval: { type: 'string', description: 'A rolling window ending now, e.g. "1 hour", "1 day".' } },
    required: ['interval'],
  },
  destructive: false,
  execute: (input, _ctx) =>
    safeExecute('count_events', async () => {
      const interval = String(input.interval ?? '');
      if (!interval) throw new Error('interval is required');
      const [counts, { monitors }] = await Promise.all([getConsoleEvents(interval), getMonitors()]);
      const nameById = new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor.Name]));
      const rows = counts
        .filter((c) => nameById.has(c.monitorId))
        .map((c) => ({ monitor: nameById.get(c.monitorId), count: c.count }));
      const total = rows.reduce((sum, r) => sum + r.count, 0);
      return JSON.stringify({ interval, total, monitors: rows });
    }),
};

/** Clamps a model-supplied limit into [1, ASSISTANT.maxListEventsLimit].
 *  Non-numeric or negative input (NaN, -5, "banana") falls back to the max
 *  instead of producing a NaN/negative EventFilters.limit. */
function clampListEventsLimit(rawLimit: unknown): number {
  const n = Number(rawLimit);
  if (!Number.isFinite(n) || n < 1) return ASSISTANT.maxListEventsLimit;
  return Math.min(n, ASSISTANT.maxListEventsLimit);
}

const listEventsTool: ToolDefinition = {
  name: 'list_events',
  description:
    'List individual events, newest first, optionally filtered by monitor, time range, detected object ' +
    'type, a single tag, or an explicit set of event ids. For "today", "yesterday", or a rolling window like ' +
    '"last hour"/"last 24 hours"/"last 7 days"/"last 30 days", pass range instead of computing startTime/' +
    'endTime yourself; the app resolves it against the profile\'s own timezone. Combine range with objectType ' +
    'for "how many people/cars today" style questions: the rows this returns for that filter are exactly what ' +
    'you must describe, since the app shows their thumbnails below your answer. Each row includes the monitor ' +
    'NAME (not just its id), the detected object types, score, duration, and a notes preview, so answer using ' +
    'those, not raw ids. A tag filter and event ids cannot be combined (the server rejects it); pass one or ' +
    'the other. An explicit startTime/endTime overrides range if both are given.',
  schema: {
    type: 'object',
    properties: {
      monitorId: {
        type: 'string',
        description:
          'A monitor id from list_monitors. A monitor name ("Front Door") also works and is resolved to its ' +
          'id. Omit to search every monitor.',
      },
      range: {
        type: 'string',
        enum: [...EVENT_RANGES],
        description:
          'A relative date/time window resolved against the profile timezone: "today" and "yesterday" are ' +
          'calendar days (local midnight to local midnight); "last_hour", "last_24h", "last_7d", "last_30d" ' +
          'are rolling windows ending now. Prefer this over startTime/endTime for anything relative.',
      },
      startTime: { type: 'string', description: 'ISO or "YYYY-MM-DD HH:MM:SS". Overrides range if set.' },
      endTime: { type: 'string', description: 'ISO or "YYYY-MM-DD HH:MM:SS". Overrides range if set.' },
      objectType: { type: 'string', description: 'e.g. "person", "car".' },
      tag: { type: 'string', description: 'A single tag id. Mutually exclusive with eventIds.' },
      eventIds: { type: 'array', items: { type: 'string' }, description: 'Mutually exclusive with tag.' },
      limit: { type: 'number', description: `Capped at ${ASSISTANT.maxListEventsLimit}.` },
    },
    additionalProperties: false,
  },
  destructive: false,
  execute: async (input, ctx) => {
    const tag = input.tag as string | undefined;
    const eventIds = input.eventIds as string[] | undefined;
    if (tag && eventIds) {
      return { output: 'Cannot filter by tag and event ids together.', isError: true };
    }
    const limit = clampListEventsLimit(input.limit);
    // Rejected before any query runs. An out-of-enum range used to fall
    // through resolveEventRange and leave the window off the query entirely,
    // so "last week" silently asked about all of time (refs #246).
    if (input.range !== undefined && !isEventRange(input.range)) {
      return {
        output: `Unknown range "${String(input.range)}". Valid ranges: ${EVENT_RANGES.join(', ')}.`,
        isError: true,
      };
    }
    return safeExecute('list_events', async () => {
      const range = input.range as EventRange | undefined;
      const explicitStart = input.startTime as string | undefined;
      const explicitEnd = input.endTime as string | undefined;
      // Explicit startTime/endTime win over range (per the tool description);
      // range only fills in whichever of the two the model left unset.
      const resolved =
        range && (!explicitStart || !explicitEnd)
          ? resolveEventRange(range, new Date(), ctx.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
          : undefined;

      // Monitors first, and awaited rather than raced with getEvents: the
      // events query cannot be built until the model's `monitorId` (often a
      // NAME) resolves to a real id. The extra round trip buys the difference
      // between "no events" and "no such query" (see monitor-ref.ts).
      const { monitors } = await getMonitors();
      let monitorId: string | undefined;
      if (input.monitorId !== undefined && String(input.monitorId).trim() !== '') {
        const resolution = resolveMonitorRef(String(input.monitorId), monitors);
        // Thrown, not returned: safeExecute keeps `isError` only on the throw
        // path (it rebuilds a returned object from `output`/`display` alone),
        // and this must reach the model as an error it can act on.
        if ('error' in resolution) throw new Error(resolution.error);
        monitorId = resolution.id;
      }

      const filters: EventFilters = {
        monitorId,
        startDateTime: explicitStart ?? resolved?.startDateTime,
        endDateTime: explicitEnd ?? resolved?.endDateTime,
        notesRegexp: input.objectType ? `detected:.*${input.objectType}` : undefined,
        tagIds: tag ? [tag] : undefined,
        eventIds,
        limit,
        sort: 'StartDateTime',
        direction: 'desc',
      };
      const res = await getEvents(filters);
      const nameById = new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor.Name]));
      const rows = res.events.map(({ Event: e }) => ({
        id: e.Id,
        monitor: nameById.get(e.MonitorId) ?? e.MonitorId,
        cause: e.Cause,
        start: e.StartDateTime,
        end: e.EndDateTime,
        durationSec: Number(e.Length),
        frames: Number(e.Frames),
        alarmFrames: Number(e.AlarmFrames),
        maxScore: Number(e.MaxScore),
        avgScore: Number(e.AvgScore),
        objects: parseDetectedObjects(e.Notes),
        archived: e.Archived === '1',
        notes: trimNotes(e.Notes, ASSISTANT.notesPreviewChars),
      }));
      // res.pagination.nextPage means more matches exist beyond this
      // (already limit-capped) page: flag it so the model says "at least N"
      // instead of implying `rows.length` is the true total (refs #246).
      const output = JSON.stringify(res.pagination.nextPage ? { truncated: true, events: rows } : { events: rows });
      // Cards mirror the same (already limit-capped) rows as the text output above.
      const display = res.events.map(({ Event: e }) =>
        buildEventDisplayEntity(e, nameById.get(e.MonitorId) ?? e.MonitorId, monitors, ctx),
      );
      return { output, display };
    });
  },
};

const getEventTool: ToolDefinition = {
  name: 'get_event',
  description:
    'Get full detail for a single event: the monitor NAME and id, duration, frame counts, scores, ' +
    'detected object types, the full notes, tags, archived state, and whether a video is available. Call ' +
    'this after list_events or count_events has identified the event id.',
  schema: {
    type: 'object',
    properties: { eventId: { type: 'string', description: 'The event id, from list_events.' } },
    required: ['eventId'],
  },
  destructive: false,
  execute: (input, ctx) =>
    safeExecute('get_event', async () => {
      const eventId = String(input.eventId ?? '');
      if (!eventId) throw new Error('eventId is required');
      const [event, { monitors }] = await Promise.all([getEvent(eventId), getMonitors()]);
      const e = event.Event;
      const nameById = new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor.Name]));
      const monitorName = nameById.get(e.MonitorId) ?? e.MonitorId;
      let tags: string[] = [];
      try {
        const tagMap = await getEventTags([eventId]);
        tags = tagMap?.get(eventId)?.map((t) => t.Name) ?? [];
      } catch {
        // Tags are an optional ZM feature (refs api/tags.ts); absence is not an error here.
      }
      const output = JSON.stringify({
        id: e.Id,
        monitor: monitorName,
        monitorId: e.MonitorId,
        cause: e.Cause,
        start: e.StartDateTime,
        end: e.EndDateTime,
        durationSec: Number(e.Length),
        frames: Number(e.Frames),
        alarmFrames: Number(e.AlarmFrames),
        maxScore: Number(e.MaxScore),
        avgScore: Number(e.AvgScore),
        totScore: Number(e.TotScore),
        objects: parseDetectedObjects(e.Notes),
        notes: e.Notes,
        tags,
        archived: e.Archived === '1',
        hasVideo: !!e.DefaultVideo,
      });
      return { output, display: [buildEventDisplayEntity(e, monitorName, monitors, ctx)] };
    }),
};

const getServerHealthTool: ToolDefinition = {
  name: 'get_server_health',
  description:
    'Get overall server health: CPU load, disk usage percentage, whether the ZoneMinder daemon is ' +
    'running, the server version, per-storage disk usage, and the configured server count. Call this for ' +
    '"is the server ok" / "is zmninja / zoneminder up" questions.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  destructive: false,
  execute: (_input, _ctx) =>
    safeExecute('get_server_health', async () => {
      const [load, disk, daemonRunning, version] = await Promise.all([
        getLoad(),
        getDiskPercent(),
        getDaemonCheck(),
        getVersion(),
      ]);
      const result: {
        load: number | number[];
        diskPercent?: number;
        daemonRunning: boolean;
        version: string;
        storages?: Array<{ name: string; diskPercent?: number; usage?: number }>;
        serverCount?: number;
      } = {
        load: load.load,
        diskPercent: disk.percent ?? disk.usage,
        daemonRunning,
        version: version.version,
      };
      // storage.json and servers.json are unsupported/empty on some ZM builds;
      // degrade gracefully instead of failing the whole tool (refs #246).
      try {
        result.storages = (await getStorages()).map(mapStorage);
      } catch {
        // omit storages
      }
      try {
        result.serverCount = (await getServers()).length;
      } catch {
        // omit serverCount
      }
      return JSON.stringify(result);
    }),
};

const listGroupsTool: ToolDefinition = {
  name: 'list_groups',
  description:
    'List monitor groups: id, name, and member monitor ids when the group carries them. Call this when ' +
    'the user refers to a group of monitors by name.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  destructive: false,
  execute: (_input, _ctx) =>
    safeExecute('list_groups', async () => {
      const { groups } = await getGroups();
      return JSON.stringify(
        groups.map((g) => {
          const monitorIds = g.Monitor?.map((m) => m.Id) ?? [];
          return monitorIds.length > 0
            ? { id: g.Group.Id, name: g.Group.Name, monitorIds }
            : { id: g.Group.Id, name: g.Group.Name };
        }),
      );
    }),
};

const listTagsTool: ToolDefinition = {
  name: 'list_tags',
  description:
    'List available event tags (id and name). Returns an empty list on ZoneMinder servers older than 1.37, ' +
    'which do not support tags.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  destructive: false,
  execute: (_input, _ctx) =>
    safeExecute('list_tags', async () => {
      const res = await getTags();
      const tags = res ? extractUniqueTags(res) : [];
      return JSON.stringify(tags.map((t) => ({ id: t.Id, name: t.Name })));
    }),
};

const navigateTool: ToolDefinition = {
  name: 'navigate',
  description:
    'Navigate the app to a specific in-app path (e.g. "/monitors/3", "/events/42", "/montage", "/timeline", ' +
    '"/dashboard", "/server"). Only call this when the user explicitly asks to be taken somewhere. Closes the ' +
    'assistant panel on success.',
  schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'An in-app path, e.g. "/events/42".' } },
    required: ['path'],
  },
  destructive: false,
  execute: async (input, ctx) => {
    const path = String(input.path ?? '');
    const allowed = NAVIGATE_ALLOWLIST.some((re) => re.test(path));
    if (!allowed) {
      return { output: `Path "${path}" is not allowed for navigation.`, isError: true };
    }
    ctx.host.navigate(path);
    return { output: 'navigated', closePanel: true };
  },
};

export const readOnlyTools: ToolDefinition[] = [
  listMonitorsTool,
  getMonitorTool,
  countEventsTool,
  listEventsTool,
  getEventTool,
  getServerHealthTool,
  listGroupsTool,
  listTagsTool,
  navigateTool,
];
