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
import { buildResultSummary, countObjects } from './result-summary';
import { parseDetectedObjects } from '../event/event-detection';
import { buildEventDisplayEntity, buildMonitorDisplayEntity } from './display';
import { resolveWindow, type WindowFields } from './event-range';
import { formatAppDateTime } from '../format-date-time';
import { resolveMonitorRef } from './monitor-ref';
import type { ToolContext, ToolDefinition } from './types';
import { safeExecute, isOmittedArg, objectTypePattern, coerceLabelList, NAVIGATE_ALLOWLIST } from './tool-helpers';

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
  // A placeholder ("null"/"none") on a REQUIRED monitor arg is a missing value,
  // not a monitor to look up: fail with the clear "required" message rather
  // than "no monitor named null".
  if (isOmittedArg(raw)) throw new Error('monitorId is required');
  const ref = String(raw).trim();
  if (/^\d+$/.test(ref)) return ref;
  const { monitors } = await getMonitors();
  const resolution = resolveMonitorRef(ref, monitors);
  if ('error' in resolution) throw new Error(resolution.error);
  return resolution.id;
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
        description: 'A monitor id from list_monitors. A monitor name exactly as list_monitors reported it also works.',
      },
    },
    required: ['monitorId'],
  },
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
    'Count events per monitor over a ROLLING window ending now (lastCount + lastUnit; {"lastCount":1,' +
    '"lastUnit":"day"} means the last 24 hours, NOT since local midnight), covering ALL monitors in one ' +
    'call (no monitorId needed) and reporting the combined total. Use this for "how many events in the ' +
    'last N hours/days" questions instead of list_events, which returns individual rows. ' +
    'It has TWO hard limits. It CANNOT express a calendar day: for "today" (since local midnight) or ' +
    '"yesterday", call list_events instead. It CANNOT filter or report detected object types: ' +
    'it returns event COUNTS ONLY and says nothing about what was detected, so for "how many ' +
    'people/cars/animals" questions call list_events with objectType instead. Calling this tool for an ' +
    'object-type question returns numbers that cannot answer it.',
  schema: {
    type: 'object',
    properties: {
      lastCount: { type: 'number', description: 'How many lastUnits back the window reaches, e.g. 24 with "hour".' },
      lastUnit: {
        type: 'string',
        enum: ['minute', 'hour', 'day', 'week', 'month'],
        description: 'The unit of the rolling window.',
      },
    },
    required: ['lastCount', 'lastUnit'],
    additionalProperties: false,
  },
  execute: (input, _ctx) =>
    safeExecute('count_events', async () => {
      const count = Number(input.lastCount);
      const unit = String(input.lastUnit ?? '');
      if (!Number.isFinite(count) || count <= 0 || !unit) throw new Error('lastCount and lastUnit are required.');
      // ZoneMinder's consoleEvents endpoint takes a MySQL INTERVAL phrase; the
      // singular unit is valid for any count ("2 week").
      const interval = `${Math.floor(count)} ${unit}`;
      const [counts, { monitors }] = await Promise.all([getConsoleEvents(interval), getMonitors()]);
      const nameById = new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor.Name]));
      const rows = counts
        .filter((c) => nameById.has(c.monitorId))
        .map((c) => ({ monitor: nameById.get(c.monitorId), count: c.count }));
      const total = rows.reduce((sum, r) => sum + r.count, 0);
      return JSON.stringify({ interval, total, monitors: rows });
    }),
};

/** A ZM timestamp re-rendered in the profile's own date/time format, so the
 *  model quotes times the way the user reads them everywhere else in the app
 *  (rule 21, refs #262). The model reliably echoes whatever format the rows
 *  carry, so formatting the data IS formatting the answer. Raw when the
 *  context carries no format (tests, older callers) or the value does not
 *  parse; query filters never pass through here.
 *  ponytail: parses the ZM wall-clock string in the runtime's own zone, same
 *  as the result cards do; a profile-timezone-aware parse needs date-fns-tz
 *  plumbing everywhere cards already accept this. */
function formatTimestamp(value: string | undefined | null, ctx: ToolContext): string | undefined | null {
  if (!value || !ctx.dateTimeFormat) return value;
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return formatAppDateTime(parsed, ctx.dateTimeFormat);
}

/** Raw ZM wall-clock starts tallied into absolute-hour buckets
 *  (`YYYY-MM-DD HH:00:00` keys). Shared by the summary's busiest-hour clause
 *  and the card-narrowing below it (refs #264). */
function hourBuckets(rawStarts: readonly string[]): Record<string, number> {
  return rawStarts.reduce<Record<string, number>>((acc, raw) => {
    const key = `${raw.slice(0, 13)}:00:00`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

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
    'List individual events, newest first, optionally filtered by monitor, time window, detected object ' +
    'type, a single tag, or an explicit set of event ids. For ANY time window, COPY the user\'s own time ' +
    'words into `when`, verbatim and in their language; the app interprets the phrase and turns it into ' +
    'exact timestamps in the profile\'s timezone. Combine when with objectType ' +
    'ONLY for questions that name an object, passing the labels this installation records (the system ' +
    'prompt lists them) and never the user\'s own word for them. Omit objectType for a summary. The ' +
    'rows this returns for a filter are exactly what ' +
    'you must describe, since the app shows their thumbnails below your answer. Each row includes the monitor ' +
    'NAME (not just its id), the detected object types, score, duration, and a notes preview, so answer using ' +
    'those, not raw ids. A tag filter and event ids cannot be combined (the server rejects it); pass one or ' +
    'the other.',
  schema: {
    type: 'object',
    properties: {
      monitorId: {
        type: 'string',
        description:
          'A monitor id from list_monitors. A monitor name exactly as list_monitors reported it also works and ' +
          'is resolved to its id. Never invent a name; omit this to search every monitor.',
      },
      when: {
        type: 'string',
        description:
          'The time window in the user\'s OWN words, copied verbatim, in whatever language they used ' +
          '("yesterday", "last week", "letzte Woche", "2 days ago", "sunday from 4pm to 10pm"). The app ' +
          'interprets the phrase and converts it to exact timestamps in the profile\'s timezone; never ' +
          'compute a date yourself and never add time words the user did not say.',
      },
      objectType: {
        // Both shapes, declared honestly: the model is asked to send a list for
        // a category word, and a schema saying "string" makes the pre-flight
        // validator reject the very thing the prompt requested.
        type: ['string', 'array'],
        items: { type: 'string' },
        description:
          'One detected object label, or several as an array, exactly as this install writes them (the ' +
          'system prompt lists the labels seen recently). For a category word pass every label that ' +
          'belongs to it, e.g. ["car","truck"] for "vehicles". If nothing matches, this tool replies with ' +
          'the labels actually recorded in that window; retry with one of those rather than reporting no ' +
          'detections.',
      },
      tag: { type: 'string', description: 'A single tag id. Mutually exclusive with eventIds.' },
      eventIds: { type: 'array', items: { type: 'string' }, description: 'Mutually exclusive with tag.' },
      limit: { type: 'number', description: `Capped at ${ASSISTANT.maxListEventsLimit}.` },
    },
    additionalProperties: false,
  },
  execute: async (input, ctx) => {
    const tag = input.tag as string | undefined;
    const eventIds = input.eventIds as string[] | undefined;
    if (tag && eventIds) {
      return { output: 'Cannot filter by tag and event ids together.', isError: true };
    }
    const limit = clampListEventsLimit(input.limit);
    return safeExecute('list_events', async () => {
      const timezone = ctx.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

      // The phrase is the user's own words; a dedicated model call interprets
      // it into structured fields (window-interpreter.ts) and resolveWindow
      // does the arithmetic (refs #265). Any failure on the way becomes a
      // corrective error the calling model retries from. Measured before
      // splitting the jobs: both reference models copied phrases perfectly
      // but filled the fields directly at 27/36 and 15/36.
      const whenPhrase = isOmittedArg(input.when) ? undefined : String(input.when);
      let resolvedWhen: { startDateTime?: string; endDateTime?: string } | undefined;
      if (whenPhrase) {
        if (!ctx.interpretWhen) throw new Error('Time phrases are unavailable right now; retry without `when`.');
        const fields = await ctx.interpretWhen(whenPhrase);
        if ('error' in fields && fields.error) throw new Error(String(fields.error));
        const window = resolveWindow(fields as WindowFields, new Date(), timezone);
        if (window && 'error' in window) throw new Error(window.error);
        resolvedWhen = window;
      }

      // Monitors first, and awaited rather than raced with getEvents: the
      // events query cannot be built until the model's `monitorId` (often a
      // NAME) resolves to a real id. The extra round trip buys the difference
      // between "no events" and "no such query" (see monitor-ref.ts).
      const { monitors } = await getMonitors();
      let monitorId: string | undefined;
      // isOmittedArg, not just an empty check: the model sends the string
      // "null"/"all" to mean "every monitor", which must not be resolved as a
      // monitor name (refs #246).
      if (!isOmittedArg(input.monitorId)) {
        const resolution = resolveMonitorRef(String(input.monitorId), monitors);
        // Thrown, not returned: safeExecute keeps `isError` only on the throw
        // path (it rebuilds a returned object from `output`/`display` alone),
        // and this must reach the model as an error it can act on.
        if ('error' in resolution) throw new Error(resolution.error);
        monitorId = resolution.id;
      }

      // Same placeholder guard: an objectType of "null" would build the regexp
      // `detected:.*null` and silently match no events.
      // A string or an array; `objectTypePattern` normalizes and sanitizes
      // both. `objectType` is only for the messages the model reads back.
      const objectTypeRaw = isOmittedArg(input.objectType) ? undefined : (input.objectType as string | string[]);
      const objectType = objectTypeRaw
        ? (Array.isArray(objectTypeRaw) ? objectTypeRaw.join(', ') : String(objectTypeRaw))
        : undefined;
      const objectPattern = objectTypeRaw ? objectTypePattern(objectTypeRaw) : undefined;
      // An objectType that normalizes to nothing must be an error, not an
      // unfiltered query: silently dropping the filter presents every event
      // as the "filtered" result.
      if (objectTypeRaw && !objectPattern) {
        throw new Error(
          `objectType "${String(objectType)}" is not a usable label. Pass a label exactly as this ` +
            'installation records it, or omit objectType entirely.',
        );
      }

      // Refused before the query, not discovered as zero rows afterwards.
      // Asked about "vehicles" the model sent objectType "vehicle" despite the
      // vocabulary being in its prompt; the query then matched nothing and the
      // honest "none" was wrong, because cars were there and a car is a
      // vehicle. A label this detector never writes cannot answer anything, so
      // the model is sent back to the real list instead.
      if (objectTypeRaw && ctx.objectLabels?.length) {
        const known = new Set(ctx.objectLabels.map((label) => label.toLowerCase()));
        const unknown = coerceLabelList(objectTypeRaw)
          .map((v) => v.toLowerCase().trim())
          .filter((v) => v.length > 0 && !known.has(v));
        if (unknown.length > 0) {
          throw new Error(
            `objectType ${unknown.map((u) => `"${u}"`).join(', ')} is not a label this installation records. ` +
              `The labels it does record are: ${ctx.objectLabels.join(', ')}. ` +
              'Retry with every label from that list that matches what the user asked about, as an array, ' +
              `for example objectType ["car","truck"] for a question about vehicles.`,
          );
        }
      }

      /** The window actually queried, in the shape the model is shown. Must
       *  mirror `filters` below exactly, `when` included: it did not, and a
       *  `when: "today"` query reported "no time filter applied" while being
       *  filtered, inviting the model to describe today's rows as every event
       *  ever recorded. A function because the zero-match branch needs it
       *  before the rows exist. */
      const windowOf = () => {
        const from = formatTimestamp(resolvedWhen?.startDateTime, ctx);
        const to = formatTimestamp(resolvedWhen?.endDateTime, ctx);
        return from || to ? { from: from ?? null, to: to ?? null } : 'all recorded events, no time filter applied';
      };

      const filters: EventFilters = {
        monitorId,
        // `when` is the only time argument this tool takes: the resolved
        // fields, or no window at all (see event-range.ts's resolveWindow).
        startDateTime: resolvedWhen?.startDateTime,
        endDateTime: resolvedWhen?.endDateTime,
        // Expanded through the category map, so "vehicles" matches the car and
        // truck rows a detector actually writes (see objectTypePattern).
        notesRegexp: objectPattern ? `detected:.*${objectPattern}` : undefined,
        tagIds: tag ? [tag] : undefined,
        eventIds,
        limit,
        sort: 'StartDateTime',
        direction: 'desc',
      };
      const res = await getEvents(filters);

      // A zero-row objectType query is ambiguous, and answering it as "nothing
      // happened" is the dangerous reading: the label may simply not be the one
      // this install's detector writes. The vocabulary is install-specific
      // (whatever wrote `detected:...` into Notes), so it cannot be an enum on
      // the schema. Instead, re-run the same window WITHOUT the object filter
      // and report the labels actually present, which the model can retry with.
      // Observed: asked "how many people came today", the model sent
      // objectType "people" against events labelled "person", got nothing, and
      // told the user nobody had come (refs #246).
      if (objectType && res.events.length === 0) {
        const probe = await getEvents({ ...filters, notesRegexp: undefined });
        // Sampled from one page of the window, not the whole window: enough to
        // name the labels in use, and it costs one request only on this path.
        const available = [...new Set(probe.events.flatMap(({ Event: e }) => parseDetectedObjects(e.Notes)))];
        if (available.length > 0) {
          return {
            output: JSON.stringify({
              summary: buildResultSummary({
                window: windowOf(),
                matchCount: 0,
                countsByMonitor: {},
                objectCounts: {},
                partial: false,
              }),
              window: windowOf(),
              objectType,
              events: [],
              matchCount: 0,
              note:
                `No "${objectType}" was detected in this window. This is the answer: tell the user there ` +
                `were none. Labels actually recorded in the same window: ` +
                `${available.slice(0, ASSISTANT.objectLabelHintLimit).join(', ')}. Answer about those ONLY ` +
                `if one of them is the same object the user asked about under a different name; otherwise ` +
                `the answer is none.`,
            }),
          };
        }
      }

      const nameById = new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor.Name]));
      // Only the fields an answer is built from. The full row (frame counts,
      // scores, end time, archived flag, and a notes preview that just repeats
      // `objects`) came to ~300 characters each, so a full 25-row result was
      // 7430 characters against a 6000 budget and `safeExecute` replaced the
      // WHOLE payload with a truncation notice. The model read that as "no
      // events" and said so, while the result cards below its answer showed the
      // events it was denying. Use get_event for detail on one row.
      const rows = res.events.map(({ Event: e }) => ({
        id: e.Id,
        monitor: nameById.get(e.MonitorId) ?? e.MonitorId,
        start: formatTimestamp(e.StartDateTime, ctx),
        durationSec: Number(e.Length),
        objects: parseDetectedObjects(e.Notes),
      }));
      // Raw wall-clock starts aligned with `rows`, for the per-hour tally
      // below: `rows.start` is already re-rendered in the profile's display
      // format, which no longer slices into hour buckets.
      const rawStarts = res.events.map(({ Event: e }) => e.StartDateTime);

      // State the window that was actually queried. Asked "how many people came
      // to my house", the model queried no time range at all and then answered
      // "no people in the last 24 hours": a period it never asked about. It
      // cannot invent one it is told.
      const window = windowOf();

      /** The exact object the model receives, for a given set of rows.
       *
       *  Built as one function so the size check below measures what is
       *  actually sent. It used to measure `{events}` alone and rely on a fixed
       *  200-character headroom to cover everything else; the summary and
       *  object tallies are big enough, and variable enough, that a fixed
       *  allowance is a guess. */
      const buildOutput = (rowsToShow: typeof rows) => {
        const truncated = rowsToShow.length < rows.length || res.pagination.nextPage;
        // The server's true match total. Two capped results both said
        // "matchCount":25 and the model compared the page caps as totals.
        const totalMatches = Math.max(res.pagination.totalCount ?? 0, rows.length);
        // Counted here, not left to the model. Asked "how many vehicles came
        // yesterday" against ten rows (four Front Yard, six Garage Outdoor), it
        // answered "8 on the Front Yard and 2 on the Garage Outdoor": the total
        // was right and the split was invented. Tallying rows is arithmetic, and
        // a 3B model does arithmetic badly, so the tally is supplied as data.
        // Covers the rows SHOWN, which are the rows the model may describe.
        const countsByMonitor = rowsToShow.reduce<Record<string, number>>((acc, row) => {
          const name = String((row as { monitor?: unknown }).monitor ?? 'unknown');
          acc[name] = (acc[name] ?? 0) + 1;
          return acc;
        }, {});
        const objectCounts = countObjects(rowsToShow as { monitor?: unknown; objects?: unknown }[]);
        // "Busiest hour" is arithmetic over timestamps, which the model does
        // badly, so the tally is computed here and the winning hour handed
        // over as a finished clause (refs #264). Buckets are absolute hours
        // (date + hour) in ZM wall clock, labelled in the profile's format.
        const hourEntries = Object.entries(hourBuckets(rawStarts.slice(0, rowsToShow.length))).sort(
          (a, b) => b[1] - a[1],
        );
        const busiestHour =
          rowsToShow.length > 1 && hourEntries.length > 0
            ? { label: String(formatTimestamp(hourEntries[0][0], ctx)), count: hourEntries[0][1] }
            : undefined;
        const countsByHour =
          hourEntries.length > 1
            ? Object.fromEntries(hourEntries.map(([key, count]) => [String(formatTimestamp(key, ctx)), count]))
            : undefined;
        // The counts, already written out. Supplying the numbers was not enough:
        // asked to summarize, the model enumerated all five rows and quoted
        // neither matchCount nor countsByMonitor. `summary` leads the object so
        // it is the first thing read.
        const summary = buildResultSummary({
          window,
          matchCount: rowsToShow.length,
          countsByMonitor,
          objectCounts,
          partial: Boolean(truncated),
          totalMatches,
        });
        // busiestHour rides OUTSIDE the summary on purpose: answers quote the
        // summary verbatim, and an hour label inside it would make the
        // answer-narrowing in agent.ts (refs #264) shrink the cards for every
        // summarize question, not just busiest-hour ones.
        const base = {
          summary,
          window,
          // The TOTAL that matched, not the page: quoted directly in answers.
          matchCount: totalMatches,
          countsByMonitor,
          objectCounts,
          ...(busiestHour ? { busiestHour } : {}),
          ...(countsByHour ? { countsByHour } : {}),
          events: rowsToShow,
        };
        return JSON.stringify(
          truncated ? { ...base, shownEvents: rowsToShow.length, moreMatchesExist: true } : base,
        );
      };

      // Drop whole rows rather than characters, so what survives is always
      // valid JSON the model can read, and say how many were dropped: a bare
      // "truncated" reads to a small model as "nothing found".
      let shown = rows;
      let output = buildOutput(shown);
      while (shown.length > 1 && output.length > ASSISTANT.maxToolResultCharacters) {
        shown = shown.slice(0, -1);
        output = buildOutput(shown);
      }

      // Cards mirror EXACTLY the rows the model was given; whether they all
      // RENDER is decided later, against the answer text (agent.ts's
      // narrowDisplayToAnswer, refs #264), because only the finished answer
      // says which rows it is about.
      const display = res.events.slice(0, shown.length).map(({ Event: e }) =>
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
        start: formatTimestamp(e.StartDateTime, ctx),
        end: formatTimestamp(e.EndDateTime, ctx),
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
