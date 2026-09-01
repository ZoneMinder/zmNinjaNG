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
