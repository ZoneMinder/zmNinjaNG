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
import { getLoad, getDiskPercent, getDaemonCheck } from '../../api/server';
import { getVersion } from '../../api/auth';
import { getGroups } from '../../api/groups';
import { getTags, getEventTags, extractUniqueTags } from '../../api/tags';
import { ASSISTANT } from '../zmninja-ng-constants';
import type { ToolDefinition } from './types';
import { safeExecute, NAVIGATE_ALLOWLIST } from './tool-helpers';

const listMonitorsTool: ToolDefinition = {
  name: 'list_monitors',
  description:
    'List all monitors visible in the current profile with their id, name, function, and enabled state. ' +
    'Call this first when the user refers to a monitor by name, or to answer "what monitors are configured".',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  destructive: false,
  execute: (_input, _ctx) =>
    safeExecute('list_monitors', async () => {
      const { monitors } = await getMonitors();
      return JSON.stringify(
        monitors.map((m) => ({
          id: m.Monitor.Id,
          name: m.Monitor.Name,
          func: m.Monitor.Function,
          enabled: m.Monitor.Enabled === '1',
        })),
      );
    }),
};

const getMonitorTool: ToolDefinition = {
  name: 'get_monitor',
  description:
    'Get full detail plus live alarm status for one monitor. Call this after list_monitors has ' +
    'resolved the name to an id, when the user asks about a specific monitor\'s current state.',
  schema: {
    type: 'object',
    properties: { monitorId: { type: 'string', description: 'The monitor id, from list_monitors.' } },
    required: ['monitorId'],
  },
  destructive: false,
  execute: (input, _ctx) =>
    safeExecute('get_monitor', async () => {
      const monitorId = String(input.monitorId ?? '');
      if (!monitorId) throw new Error('monitorId is required');
      const [monitor, alarm] = await Promise.all([getMonitor(monitorId), getAlarmStatus(monitorId)]);
      return JSON.stringify({
        id: monitor.Monitor.Id,
        name: monitor.Monitor.Name,
        func: monitor.Monitor.Function,
        enabled: monitor.Monitor.Enabled === '1',
        alarm: { status: alarm.status, output: alarm.output },
      });
    }),
};

const countEventsTool: ToolDefinition = {
  name: 'count_events',
  description:
    'Count events per monitor over a rolling interval such as "1 hour" or "1 day", covering ALL monitors ' +
    'in one call (no monitorId needed). Use this for "how many events happened" or "summarize events" ' +
    'questions instead of list_events, which returns individual rows.',
  schema: {
    type: 'object',
    properties: { interval: { type: 'string', description: 'e.g. "1 hour", "1 day".' } },
    required: ['interval'],
  },
  destructive: false,
  execute: (input, _ctx) =>
    safeExecute('count_events', async () => {
      const interval = String(input.interval ?? '');
      if (!interval) throw new Error('interval is required');
      const [counts, { monitors }] = await Promise.all([getConsoleEvents(interval), getMonitors()]);
      const nameById = new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor.Name]));
      return JSON.stringify(
        counts
          .filter((c) => nameById.has(c.monitorId))
          .map((c) => ({ monitor: nameById.get(c.monitorId), count: c.count })),
      );
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
    'type, a single tag, or an explicit set of event ids. A tag filter and event ids cannot be combined ' +
    '(the server rejects it); pass one or the other.',
  schema: {
    type: 'object',
    properties: {
      monitorId: { type: 'string' },
      startTime: { type: 'string', description: 'ISO or "YYYY-MM-DD HH:MM:SS".' },
      endTime: { type: 'string', description: 'ISO or "YYYY-MM-DD HH:MM:SS".' },
      objectType: { type: 'string', description: 'e.g. "person", "car".' },
      tag: { type: 'string', description: 'A single tag id. Mutually exclusive with eventIds.' },
      eventIds: { type: 'array', items: { type: 'string' }, description: 'Mutually exclusive with tag.' },
      limit: { type: 'number', description: `Capped at ${ASSISTANT.maxListEventsLimit}.` },
    },
    additionalProperties: false,
  },
  destructive: false,
  execute: async (input, _ctx) => {
    const tag = input.tag as string | undefined;
    const eventIds = input.eventIds as string[] | undefined;
    if (tag && eventIds) {
      return { output: 'Cannot filter by tag and event ids together.', isError: true };
    }
    const limit = clampListEventsLimit(input.limit);
    return safeExecute('list_events', async () => {
      const filters: EventFilters = {
        monitorId: input.monitorId as string | undefined,
        startDateTime: input.startTime as string | undefined,
        endDateTime: input.endTime as string | undefined,
        notesRegexp: input.objectType ? `detected:.*${input.objectType}` : undefined,
        tagIds: tag ? [tag] : undefined,
        eventIds,
        limit,
        sort: 'StartDateTime',
        direction: 'desc',
      };
      const res = await getEvents(filters);
      return JSON.stringify(
        res.events.map((e) => ({
          id: e.Event.Id,
          monitor: e.Event.MonitorId,
          cause: e.Event.Cause,
          start: e.Event.StartDateTime,
          score: e.Event.MaxScore,
        })),
      );
    });
  },
};

const getEventTool: ToolDefinition = {
  name: 'get_event',
  description:
    'Get full detail for a single event: duration, frame count, score, notes (object-detection results), ' +
    'and tags. Call this after list_events or count_events has identified the event id.',
  schema: {
    type: 'object',
    properties: { eventId: { type: 'string', description: 'The event id, from list_events.' } },
    required: ['eventId'],
  },
  destructive: false,
  execute: (input, _ctx) =>
    safeExecute('get_event', async () => {
      const eventId = String(input.eventId ?? '');
      if (!eventId) throw new Error('eventId is required');
      const event = await getEvent(eventId);
      const e = event.Event;
      let tags: string[] = [];
      try {
        const tagMap = await getEventTags([eventId]);
        tags = tagMap?.get(eventId)?.map((t) => t.Name) ?? [];
      } catch {
        // Tags are an optional ZM feature (refs api/tags.ts); absence is not an error here.
      }
      return JSON.stringify({
        id: e.Id,
        monitor: e.MonitorId,
        cause: e.Cause,
        duration: Number(e.Length),
        frames: Number(e.Frames),
        score: Number(e.MaxScore),
        notes: e.Notes,
        tags,
      });
    }),
};

const getServerHealthTool: ToolDefinition = {
  name: 'get_server_health',
  description:
    'Get overall server health: CPU load, disk usage percentage, whether the ZoneMinder daemon is ' +
    'running, and the server version. Call this for "is the server ok" / "is zmninja / zoneminder up" questions.',
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
      return JSON.stringify({
        load: load.load,
        diskPercent: disk.percent ?? disk.usage,
        daemonRunning,
        version: version.version,
      });
    }),
};

const listGroupsTool: ToolDefinition = {
  name: 'list_groups',
  description: 'List monitor groups (id and name). Call this when the user refers to a group of monitors by name.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  destructive: false,
  execute: (_input, _ctx) =>
    safeExecute('list_groups', async () => {
      const { groups } = await getGroups();
      return JSON.stringify(groups.map((g) => ({ id: g.Group.Id, name: g.Group.Name })));
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
