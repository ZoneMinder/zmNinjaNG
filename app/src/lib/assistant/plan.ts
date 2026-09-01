/**
 * Composes the tool calls a parsed question determines, in code (refs #432).
 *
 * The parse stage (triage.ts) turns the question into validated slots:
 * subject, resolved monitors, recorded labels, and the timeframe stage's
 * phrases. When those slots determine the calls, no model round should be
 * choosing tools or filling arguments - both are exactly where small models
 * measured worst (wrong tool, spurious filters, single-name substitution) -
 * so this module builds them and `runAssistantTurn` executes them before the
 * first model round. A null plan means the slots do not determine the calls,
 * and the turn runs today's free tool loop unchanged: the fallback costs
 * nothing because it is the existing path.
 */
import type { RequestKind, QuerySubject } from './triage';
import type { MonitorRosterEntry } from './monitor-stage';
import { ASSISTANT } from '../zmninja-ng-constants';
import { buildResultSummary, type ResultWindow } from './result-summary';

export interface PlannedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface QueryPlanInput {
  kind: RequestKind;
  subject?: QuerySubject;
  /** Resolved monitor set; [] plans one unpinned query. */
  monitors: MonitorRosterEntry[];
  /** Recorded labels the question asks about; [] plans no object filter. */
  objects: string[];
  /** The timeframe stage's resolved phrases, one query window each. */
  phrases: string[];
}

export function planToolCalls(q: QueryPlanInput): PlannedToolCall[] | null {
  if (q.kind !== 'zoneminder') return null;
  if (q.subject === 'server') return [{ name: 'get_server_health', input: {} }];
  if (q.subject === 'monitors') return [{ name: 'list_monitors', input: {} }];
  if (q.subject === 'groups') return [{ name: 'list_groups', input: {} }];
  if (q.subject !== 'events') return null;
  if (q.phrases.length === 0) return null;

  const monitorSlots: Array<MonitorRosterEntry | undefined> = q.monitors.length > 0 ? q.monitors : [undefined];
  const calls: PlannedToolCall[] = [];
  for (const phrase of q.phrases) {
    for (const monitor of monitorSlots) {
      calls.push({
        name: 'list_events',
        input: {
          when: phrase,
          ...(monitor ? { monitorId: monitor.id } : {}),
          ...(q.objects.length > 0 ? { objectType: q.objects.length === 1 ? q.objects[0] : q.objects } : {}),
        },
      });
    }
  }
  // phrases x monitors can explode ("compare every camera may to june"); past
  // the cap the free loop's own judgment beats a mechanical fan-out.
  if (calls.length > ASSISTANT.maxPlannedToolCalls) return null;
  return calls;
}

/** The subset of a list_events result body the merge reads and rebuilds. */
interface EventResultBody {
  window?: { from?: string; to?: string } | string;
  matchCount?: number;
  countsByMonitor?: Record<string, number>;
  objectCounts?: Record<string, number>;
  countsByHour?: Record<string, number>;
  events?: Array<{ id?: unknown }>;
  moreMatchesExist?: boolean;
}

/** Adds `extra`'s numeric entries into `into`. */
function addCounts(into: Record<string, number>, extra: Record<string, number> | undefined): void {
  for (const [key, value] of Object.entries(extra ?? {})) {
    into[key] = (into[key] ?? 0) + Number(value);
  }
}

/**
 * One merged result for a plan that fanned the SAME window and filter over
 * several monitors, or null when the calls are not that shape (refs #436).
 *
 * Observed live: handed two per-monitor results, the model summed the totals
 * itself and quoted ONE monitor's objectCounts and busiest hour (5 where the
 * combined truth was 8). Cross-result arithmetic is exactly what the
 * per-result summary sentence exists to spare it, so the merge happens here,
 * in code: summed matchCount, merged per-monitor / per-object / per-hour
 * counts, the busiest hour recomputed, rows re-sorted newest-first by id
 * (ZoneMinder ids are monotonic) and re-capped, and one summary sentence the
 * model can only quote. objectCounts and busiestHour are omitted whenever any
 * source result lacks them: a partial sum would be stated as a total.
 *
 * The synthetic call carries the shared window and filter WITHOUT a
 * monitorId, which is exactly what it now describes; the real per-monitor
 * calls stay in the trace, and their signatures stay registered.
 */
export function mergePlannedEventResults(
  calls: ReadonlyArray<{ id?: string; name: string; input: Record<string, unknown> }>,
  results: ReadonlyArray<{ callId?: string; output: string; isError?: boolean; display?: unknown[] }>,
): { call: { id: string; name: string; input: Record<string, unknown> }; result: { callId: string; output: string; isError: false; display?: never[] } } | null {
  if (calls.length < 2 || calls.length !== results.length) return null;
  if (!calls.every((c) => c.name === 'list_events')) return null;
  if (results.some((r) => r.isError)) return null;
  const sharedKey = (input: Record<string, unknown>) => JSON.stringify({ when: input.when, objectType: input.objectType });
  if (!calls.every((c) => sharedKey(c.input) === sharedKey(calls[0].input))) return null;

  const bodies: EventResultBody[] = [];
  for (const r of results) {
    try {
      bodies.push(JSON.parse(r.output) as EventResultBody);
    } catch {
      return null;
    }
  }

  const matchCount = bodies.reduce((sum, b) => sum + (Number(b.matchCount) || 0), 0);
  const countsByMonitor: Record<string, number> = {};
  for (const b of bodies) addCounts(countsByMonitor, b.countsByMonitor);

  const haveObjects = bodies.every((b) => b.objectCounts !== undefined);
  const objectCounts: Record<string, number> = {};
  if (haveObjects) for (const b of bodies) addCounts(objectCounts, b.objectCounts);

  const haveHours = bodies.every((b) => b.countsByHour !== undefined);
  const countsByHour: Record<string, number> = {};
  if (haveHours) for (const b of bodies) addCounts(countsByHour, b.countsByHour);
  const busiest = Object.entries(countsByHour).sort(([, a], [, b]) => b - a)[0];

  const allRows = bodies.flatMap((b) => (Array.isArray(b.events) ? b.events : []));
  const rows = [...allRows].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, ASSISTANT.maxListEventsLimit);
  const capped = rows.length < allRows.length || bodies.some((b) => b.moreMatchesExist === true);

  const window = bodies[0].window;
  const body: Record<string, unknown> = {
    summary: buildResultSummary({
      window: window as ResultWindow,
      matchCount,
      countsByMonitor,
      objectCounts: haveObjects ? objectCounts : {},
      partial: capped,
    }),
    window,
    matchCount,
    countsByMonitor,
    ...(haveObjects ? { objectCounts } : {}),
    ...(haveHours && busiest ? { busiestHour: { label: busiest[0], count: busiest[1] }, countsByHour } : {}),
    events: rows,
    ...(capped ? { shownEvents: rows.length, moreMatchesExist: true } : {}),
  };

  const { monitorId: _dropped, ...sharedInput } = calls[0].input;
  return {
    call: { id: 'planned-1', name: 'list_events', input: sharedInput },
    result: { callId: 'planned-1', output: JSON.stringify(body), isError: false },
  };
}
