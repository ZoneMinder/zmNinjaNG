/**
 * Tool-contract eval cases: a question in, the tool that should answer it out
 * (refs #270).
 *
 * Lifted verbatim out of `scripts/prompt-eval.mts`, which owned them privately,
 * so the HTTP harness and the on-device runner score the SAME list. The reason
 * they had to move is the reason `time-eval-cases.ts` exists: a second copy of an
 * eval drifts from the first and then measures a bug the app does not have.
 * `prompt-eval.mts` now imports these; nothing re-declares them.
 *
 * Every case is a real fault someone hit. The comments say which, because a case
 * whose motivation is lost is a case nobody dares delete.
 */

export interface ToolCase {
  q: string;
  /** Tool that answers it. `null` means no tool should be called at all. */
  tool: string | null;
  /** Argument check. Absent means any arguments pass. */
  args?: (a: Record<string, unknown>) => boolean;
  /** Handled by triage before the prompt sees it in production. Still SCORED here:
   *  this benchmark measures the model's own planning, and "recognise that no
   *  lookup is needed" is half of it. Triage is a safety net in front of that
   *  judgement, not a substitute for measuring it. */
  triaged?: boolean;
  /** Check `tool` and `args` against EVERY call in the reply, not just the
   *  first. For multi-window questions where a fault on any call corrupts
   *  the answer ("compare X to Y" creeping objectType onto both calls). */
  allCalls?: boolean;
}

export const TOOL_CASES: ToolCase[] = [
  { q: 'summarize today', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('today') && a.objectType === undefined },
  { q: 'what happened yesterday', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('yesterday') && a.objectType === undefined },
  // The phrasings the old English phrase grammar could not read (refs #265):
  // the model interprets them into structured fields, in any language.
  { q: 'summarize last week', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('last week') },
  { q: 'what happened in the past 2 weeks', tool: 'list_events', args: (a) => /past 2 weeks|2 weeks/.test(String(a.when).toLowerCase()) },
  { q: 'was war gestern bei mir los', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('gestern') },
  // A summary must not grow an objectType: observed live on "summarize april",
  // which attached every known label and silently excluded no-detection events.
  { q: 'summarize april', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('april') && a.objectType === undefined },
  // Observed live (refs #246): "compare may to june" attached the whole known
  // vocabulary to BOTH calls, silently excluding no-detection events.
  {
    q: 'compare may to june',
    tool: 'list_events',
    allCalls: true,
    args: (a) => /may|june/.test(String(a.when).toLowerCase()) && a.objectType === undefined,
  },
  { q: 'how many people came today', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('today') && String(a.objectType).includes('person') },
  // Triage answers these with NO tools in production (see triage.ts), so the
  // prompt is not what decides them. Kept visible, scored separately.
  {
    q: 'how many vehicles came yesterday',
    tool: 'list_events',
    args: (a) => {
      const t = (a.objectType ?? []) as string[];
      return String(a.when).toLowerCase().includes('yesterday') && t.includes('car') && t.includes('truck');
    },
  },
  // count_events measures ONE rolling window and cannot rank hours; the
  // list_events result carries the app-computed busiest-hour clause (refs #264).
  { q: 'what was my busiest hour yesterday', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('yesterday') },
  { q: 'is the server ok', tool: 'get_server_health' },
  { q: 'what cameras do I have', tool: 'list_monitors' },
  { q: 'how many events in the last 24 hours', tool: 'count_events', args: (a) => (a.lastUnit === 'hour' && a.lastCount === 24) || (a.lastUnit === 'day' && a.lastCount === 1) },
  { q: 'what tags are available', tool: 'list_tags' },
  { q: 'hello', tool: null, triaged: true },
  { q: 'what is the capital of France', tool: null, triaged: true },

  // ---- Planning: which tool, and with what window ----------------------------
  // count_events measures ONE rolling window; list_events answers anything
  // calendar-aligned. Picking the wrong one silently changes what is counted.
  { q: 'how many events in the past hour', tool: 'count_events', args: (a) => a.lastUnit === 'hour' && a.lastCount === 1 },
  { q: 'how many events in the last 7 days', tool: 'count_events', args: (a) => (a.lastUnit === 'day' && a.lastCount === 7) || (a.lastUnit === 'week' && a.lastCount === 1) },
  { q: 'anything on the front door camera today', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('today') },
  { q: 'show me events from last night', tool: 'list_events', args: (a) => /last night|night/.test(String(a.when).toLowerCase()) },
  { q: 'what happened between 2pm and 6pm yesterday', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('yesterday') },
  { q: 'what happened on the 21st', tool: 'list_events', args: (a) => /21/.test(String(a.when)) },
  { q: 'events since july 1', tool: 'list_events', args: (a) => /july 1|since july/.test(String(a.when).toLowerCase()) },

  // ---- Planning: the object vocabulary --------------------------------------
  // A question naming a thing takes objectType; one that does not must not grow
  // it, or no-detection events are silently excluded.
  { q: 'were there any cars yesterday', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('yesterday') && String(a.objectType).includes('car') },
  { q: 'any packages delivered today', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('today') },
  { q: 'what was the quietest day this week', tool: 'list_events', args: (a) => a.objectType === undefined },

  // ---- Planning: tags --------------------------------------------------------
  { q: 'what tags do I have', tool: 'list_tags' },
  { q: 'show me events tagged important', tool: 'list_events', args: (a) => String(a.tag ?? '').toLowerCase().includes('important') },

  // ---- Planning: the non-event surfaces --------------------------------------
  { q: 'which cameras are recording right now', tool: 'list_monitors' },
  { q: 'what camera groups exist', tool: 'list_groups' },
  { q: 'is everything healthy', tool: 'get_server_health' },
  { q: 'is the backyard camera alarmed', tool: 'get_monitor' },

  // ---- Planning: recognising that NO lookup is needed -------------------------
  // The other half of the judgement. A model that fetches events to answer
  // "thanks" is as wrong as one that answers a data question without fetching.
  { q: 'thanks!', tool: null, triaged: true },
  { q: 'what can you do', tool: null, triaged: true },
  { q: 'who won the world cup in 2018', tool: null, triaged: true },
  { q: 'how do I add a camera', tool: null, triaged: true },
  // Read-only means the plan for a mutation is to refuse, never to call a tool.
  { q: 'arm the backyard camera', tool: null, triaged: true },
  { q: 'delete event 1234', tool: null, triaged: true },
];

/** The object vocabulary the cases are written against ("how many vehicles"
 *  expects car+truck). Shared with the harness so both build the same prompt. */
export const CONTRACT_EVAL_OBJECT_LABELS = ['car', 'carrot', 'person', 'truck'];

/**
 * The servers the group cases below are written against (refs #337).
 *
 * Two names a model has no prior for, so a pass means it read the roster in
 * the prompt rather than recognising a word it already knew.
 */
export const SERVER_EVAL_SERVERS = ['warehouse', 'cabin'];

/**
 * Cases that only exist while the app is showing a group of servers.
 *
 * Deliberately a SEPARATE list rather than more entries in `TOOL_CASES`: these
 * need a prompt naming the servers and a registry carrying the `server`
 * argument, and `scripts/prompt-eval.mts` builds neither. Folding them into
 * the shared list would score them there against a prompt that never mentions
 * a server, reporting a model failure that is really a harness one. The
 * on-device runner (`contract-eval.ts`) builds the scoped pair and runs these
 * after the shared list.
 */
export const SERVER_TOOL_CASES: ToolCase[] = [
  // The question this whole feature came from: two profile names in one
  // sentence, which used to reach the model as two meaningless nouns.
  {
    q: 'compare events in warehouse and cabin today',
    tool: 'list_events',
    allCalls: true,
    args: (a) => a.server === 'warehouse' || a.server === 'cabin',
  },
  { q: 'how many events on warehouse today', tool: 'list_events', args: (a) => a.server === 'warehouse' },
  { q: 'which cameras are recording on cabin', tool: 'list_monitors', args: (a) => a.server === 'cabin' },
  // The other half of the contract: a question that names no server must NOT
  // pick one, or the answer silently covers a fraction of what was asked.
  { q: 'what happened today', tool: 'list_events', args: (a) => a.server === undefined },
];
