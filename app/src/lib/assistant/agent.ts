/**
 * Agent tool-use loop (refs #246).
 *
 * Every tool this loop can reach is read-only. That is a property of the
 * registry and the type, not of anything decided here at runtime: `TOOLS`
 * contains only read-only tools, `ToolDefinition` cannot express an action
 * that changes state, and no tool the assistant owns imports a mutating API.
 * So there is no confirmation gate in this file and nothing for a model to
 * talk its way past (see tools.ts for why the actions were removed).
 */
import type { AssistantMessage, AssistantProvider, AssistantHost, DisplayEntity, TokenUsage, TraceEntry, ToolCall, ToolContext, ToolDefinition, ToolResult } from './types';
import { getToolByName, isWithheldToolName, TOOLS } from './tools';
import { validateToolInput, objectQuestionMismatch, toolCallSignature, stripOmittedArgs, repairCountEventsInterval } from './tool-helpers';
import { captureApiCalls } from './api-capture';
import { extractShowDirective, filterDisplayByShow } from './display';
import { buildGroundingCorrection, fallbackAnswerFromData, retryIsUnusable } from './grounding';
import { sanitizeModelText } from './sanitize';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

/** Localized by the panel at render (Task 8): agent.ts never renders user-facing
 *  text itself, it only ever emits this key behind the `__i18n:` sentinel. */
const ITERATION_CAP_KEY = 'assistant.iteration_cap_reached';

/** The last resort for a turn that produced no answer text and no tool summary
 *  to build one from. Same key the providers emit for an unparseable reply
 *  (`PARSE_ERROR_TEXT`), restated here rather than imported so the loop keeps
 *  no dependency on any one provider module. */
const PARSE_ERROR_KEY = 'assistant.parse_error';

/** Returned to the model when it calls one of the actions the assistant no
 *  longer implements (see `WITHHELD_TOOL_NAMES` in tools.ts). Model-facing, so
 *  it is plain English the model rewrites for the user, not an `__i18n:` key. */
const WITHHELD_TOOL_REFUSAL =
  'That action is not something this assistant can do. It has no tool for it at all. ' +
  'Actions that change or delete things (arming and disarming monitors, changing the run state or a ' +
  'monitor function, triggering or cancelling alarms, deleting or archiving events) are not available, ' +
  'because a language model can misread a request and act on something the user did not ask for, and ' +
  'some of those actions cannot be undone. Tell the user this action must be done by hand in the app, ' +
  'and say where: monitors and arming on the Monitors screen, run state on the Server screen, event ' +
  'deletion and archiving on that event. Do not retry any tool for this request.';

/** Appended to a rejected or thrown tool result. Observed on-device: a
 *  count_events rejected with "lastCount is required" was followed by the model
 *  answering "There were 10 events recorded today" with no tool data at all. The
 *  bare validator error invites answering without data, so spell out the two
 *  allowed moves and forbid inventing facts (refs #270). */
const TOOL_FAILURE_GUARD =
  ' Either correct the call and try again, or tell the user the data could not be retrieved.' +
  ' Never state counts, times, or facts you did not get from a tool result.';

/** Model-facing pushback before the fail-open gate unlocks the registry (refs #270). */
const TOOL_LESS_PUSHBACK =
  'No tools are available for this turn. If the user\'s message is conversation (a greeting, thanks, ' +
  'small talk), answer it in plain text. Only call this tool again if the user genuinely asked about ' +
  'this ZoneMinder system (cameras, events, detections, server).';


/** De-dupes by `kind`+`id` (the same event/monitor can surface from more than
 *  one tool call in a turn, e.g. list_events then get_event on one of its
 *  rows) and returns `undefined` for an empty turn so `AssistantMessage.display`
 *  stays unset rather than `[]` (refs #246). */
function dedupeDisplay(entities: DisplayEntity[]): DisplayEntity[] | undefined {
  if (entities.length === 0) return undefined;
  const seen = new Set<string>();
  const deduped: DisplayEntity[] = [];
  for (const entity of entities) {
    const key = `${entity.kind}:${entity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entity);
  }
  return deduped;
}

/** Keep whole turns only. Walk from the end; if the first kept message is a
 *  tool result, drop it so history never opens on an orphan. */
/** Only what the model is actually SENT.
 *
 *  This used to measure `JSON.stringify(toolResults)`, which carries two
 *  fields the model never sees: `display` (the result cards, whose thumbnail
 *  URLs each embed a signed token) and `apiCalls` (transcript diagnostics). A
 *  twelve-event `list_events` result was 195 characters of model-visible
 *  output and 17135 characters once the cards were counted, so it blew the
 *  12000 budget on its own. `truncateHistory` then dropped the tool call AND
 *  its result, leaving only the question: the model re-asked the same thing
 *  every round, having apparently never been told the answer, until a result
 *  small enough to survive (a plain error, which carries no cards) finally
 *  stayed in history. Budget what is sent, not what is stored. */
function messageCharacters(message: AssistantMessage): number {
  const toolResults =
    message.toolResults?.reduce(
      // ~40 characters for the wrapper the provider adds per result: the role,
      // the call id, and the JSON punctuation around the output.
      (total, result) => total + result.output.length + 40,
      0,
    ) ?? 0;
  return (message.text?.length ?? 0) + (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0) + toolResults;
}

export function truncateHistory(
  history: AssistantMessage[],
  max: number,
  maxCharacters = Number.POSITIVE_INFINITY,
  maxTurns = Number.POSITIVE_INFINITY,
): AssistantMessage[] {
  const tail: AssistantMessage[] = [];
  let characters = 0;
  let turns = 0;
  for (let i = history.length - 1; i >= 0 && tail.length < max; i--) {
    const message = history[i];
    // A user message opens a turn, so counting them walking backwards counts
    // whole exchanges. Stop BEFORE taking one turn too many, and never on the
    // first message, so the current turn always survives its own cap.
    if (message.role === 'user') {
      turns++;
      if (turns > maxTurns && tail.length > 0) break;
    }
    const size = messageCharacters(message);
    if (tail.length > 0 && characters + size > maxCharacters) break;
    tail.unshift(message);
    characters += size;
  }
  while (tail.length && tail[0].role === 'tool') tail.shift();
  // Whole turns only. Walking backwards stops ON the user message that would
  // exceed the cap, so the assistant reply BELONGING to that dropped turn is
  // still at the front: without this, a cap of 2 kept "answer 2" with no
  // "question 2" in front of it, which reads as the model having said
  // something unprompted.
  if (Number.isFinite(maxTurns)) {
    while (tail.length && tail[0].role !== 'user') tail.shift();
  }

  // The question being answered must survive its own turn. Trimming drops the
  // OLDEST messages, and in a turn that calls more than one tool the oldest
  // message is the user's question: "summarize today" made two calls and left
  // the model holding tool results with no idea what had been asked. Pinning it
  // costs one short message and is the difference between an answer and a guess.
  const lastUser = [...history].reverse().find((message) => message.role === 'user');
  if (lastUser && !tail.includes(lastUser)) tail.unshift(lastUser);

  return tail;
}

/** Everything after the LAST `contextBoundary` message, which is what an
 *  auto-clear (AskPanel) leaves behind. The boundary message itself is dropped
 *  too: it is a UI notice, not something the model should answer.
 *
 *  This is where an auto-clear becomes real. The thread in the store keeps
 *  every message so the transcript still renders, and only this slice decides
 *  what reaches `provider.chat`, so clearing frees context without deleting
 *  what the user can see. */
export function sliceAfterContextBoundary(history: AssistantMessage[]): AssistantMessage[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].contextBoundary) return history.slice(i + 1);
  }
  return history;
}

/**
 * Whether the next turn should start from a cleared context.
 *
 * Judged on `promptTokens` from the turn that just finished: that is the real
 * measured size of everything sent in (system prompt + tool schemas + history
 * + tool results), and the next turn's prompt can only be bigger, since it
 * adds this turn's answer and the next question on top.
 *
 * False whenever either input is unknown. `contextWindow` is undefined for
 * Ollama (the window is the server's `num_ctx` and the OpenAI-compatible API
 * never reports it) and usage is undefined for a backend that omits it, and a
 * guess in either case would either clear a conversation that was fine or
 * promise a safety that isn't there.
 */
export function isContextNearlyFull(
  contextWindow: number | undefined,
  usage: TokenUsage | undefined,
): boolean {
  if (!contextWindow || !usage) return false;
  return usage.promptTokens >= contextWindow * ASSISTANT.contextClearThreshold;
}

export interface RunOpts {
  provider: AssistantProvider;
  host: AssistantHost;
  ctx: ToolContext;
  history: AssistantMessage[];
  system: string;
  signal: AbortSignal;
  /** Detected-object labels this install writes, used to refuse a tool that
   *  cannot answer an object-type question (see the guard in the loop). */
  objectLabels?: string[];
  /** Trace entries produced before the loop ran (the question itself, and the
   *  triage round), so the saved transcript is complete rather than starting
   *  mid-turn. */
  initialTrace?: TraceEntry[];
  /** The tools this turn may use. Defaults to the full registry. AskPanel
   *  passes `[]` for a request triage classified as chat or as an unsupported
   *  action (see triage.ts): those are answered as plain text, and the way to
   *  stop a small model reaching for a tool is to hand it none, not to ask it
   *  nicely. */
  tools?: ToolDefinition[];
  /** How many previous exchanges the model is shown. Defaults to
   *  `ASSISTANT.maxHistoryTurns`; Settings can raise or lower it. */
  historyTurns?: number;
}

/**
 * Runs one turn and resolves with ONLY the messages this turn produced, in
 * order, for the caller to append to the thread it already holds.
 *
 * Not the full history: what gets sent to the model is a trimmed view of the
 * caller's thread (boundary slice, then the message cap), so a returned
 * "history" would be a different length than the caller's own and any
 * arithmetic against it would be wrong. Returning just the new messages leaves
 * the caller nothing to compute.
 */
export async function runAssistantTurn(opts: RunOpts): Promise<AssistantMessage[]> {
  const { provider, host, ctx, system, signal } = opts;
  const tools = opts.tools ?? TOOLS;
  // Boundary slice BEFORE the message-count truncation: the cap counts what
  // the model will actually be sent, so a pre-boundary message must never
  // occupy one of those slots.
  const history = truncateHistory(
    sliceAfterContextBoundary(opts.history),
    ASSISTANT.maxHistoryMessages,
    ASSISTANT.maxHistoryCharacters,
    opts.historyTurns ?? ASSISTANT.maxHistoryTurns,
  );
  // Everything appended below goes onto BOTH: `history` is the model's view
  // for the next iteration, `produced` is what the caller gets back.
  const produced: AssistantMessage[] = [];
  const push = (msg: AssistantMessage) => {
    history.push(msg);
    produced.push(msg);
  };
  // Cards accumulate across every tool-calling iteration of this turn and land
  // on the FINAL assistant answer message only (never an intermediate
  // tool-call-only assistant message or a `role: 'tool'` message), so AskPanel
  // renders question -> steps -> answer text -> cards (refs #246).
  const turnDisplay: DisplayEntity[] = [];
  /** Everything this turn did, in the order it happened, for the panel's
   *  transcript. Emitted to `host.onTrace` as it accumulates so the panel can
   *  show it live, AND attached to the final message so it survives in
   *  history. */
  const turnTrace: TraceEntry[] = [...(opts.initialTrace ?? [])];
  const trace = (entry: TraceEntry) => {
    turnTrace.push(entry);
    host.onTrace?.(entry);
  };
  /** Usage from the most recent `provider.chat` that reported any, so the
   *  iteration-cap message below can still tell AskPanel how full the window
   *  got: a turn that burns every iteration is exactly the kind that fills it. */
  let lastUsage: TokenUsage | undefined;
  /** The tools THIS turn may execute. Starts as the caller's routing decision
   *  and fails OPEN (refs #265): when a tool-less (triage chat/action) turn
   *  produces a call for a real registry read tool, the model's own attempt
   *  is better routing evidence than any classifier, so the turn flips to the
   *  full registry and the call runs instead of being refused. Everything in
   *  the registry is read-only, so opening up is always safe. */
  let activeTools = tools;
  /** Language-neutral live-data net (refs #259, #265: this replaced English
   *  keyword regexes entirely): a turn routed here WITH tools that answers
   *  without ever attempting one gets a single generic reminder, in any
   *  language. It never hard-fails; the second tool-less answer is accepted. */
  let genericToolReminderSent = false;
  /** The fail-open gate (below) gets ONE corrective pushback before it opens
   *  the registry. Observed on-device: Apple Foundation Models answered "hello"
   *  (triaged CHAT, tool-less turn) by calling count_events, and the bare
   *  fail-open ran it, so a greeting came back as an event report. A model that
   *  insists after one explicit pushback has out-voted the classifier (keeps the
   *  #265 "summarize last week" recovery); a format-reflex call does not survive
   *  the pushback. */
  let toolLessPushbackSent = false;
  /** `name:JSON(input)` for every tool call attempted this turn, so an
   *  identical repeat can be refused rather than re-run (see the loop below). */
  const calledSignatures = new Set<string>();
  /** Whether the model attempted ANY tool call this turn, successful or not.
   *  The generic reminder below targets a model that answered without even
   *  trying a tool; a model whose attempts were refused (withheld action,
   *  unknown name) already got its guidance as tool results. */
  let anyToolCallAttempted = false;
  /** Every tool result this turn produced, for the verification step. */
  const toolOutputs: string[] = [];
  /** The grounding check runs at most once, like the optional judge: a model
   *  that fails it twice is not going to pass on a third ask, and the data
   *  fallback below is a better use of the round than another attempt. */
  let groundingRetried = false;
  const question = [...opts.history].reverse().find((m) => m.role === 'user')?.text ?? '';

  /** Everything that happens to ONE tool call: the fail-open pushback, the
   *  unknown/withheld-name refusals, the duplicate-signature guard, argument
   *  normalization, the object-question and schema refusals, execution with API
   *  capture, and the activity/trace reporting. Always resolves with exactly one
   *  `ToolResult`, never rejects.
   *
   *  A closure rather than a top-level function because every one of those steps
   *  reads or writes this turn's state (`activeTools`, `calledSignatures`,
   *  `toolOutputs`, the trace). It exists so a backend whose own runtime drives
   *  the tool loop (see `runTool` in types.ts) runs each call through the SAME
   *  machinery as the loop below rather than a parallel copy of it. */
  const runOneCall = async (call: ToolCall): Promise<ToolResult> => {
    // THIS turn's tool list is the execution authority: a caller that
    // passes its own definitions (tests, fixtures) must have exactly those
    // run. One exception fails OPEN (refs #265): a turn that was routed
    // here with NO tools (triage said chat/action) but whose model calls a
    // real registry read tool has just out-voted the classifier: "summarize
    // last week" was triaged CHAT, the model called list_events anyway, and
    // refusing it turned a correct instinct into an apology. The registry
    // is read-only, so honoring the call is always safe.
    //
    // But one pushback first (refs #270): Apple Foundation Models answered a
    // bare "hello" by calling count_events, and opening the registry on that
    // first call turned a greeting into an event report. So the first
    // tool-less call gets a corrective error asking the model to answer
    // conversation in plain text; only a model that INSISTS on the second
    // call has really out-voted the classifier. A format reflex does not
    // survive the pushback; the #265 "summarize last week" recovery does.
    if (activeTools.length === 0 && tools.length === 0 && getToolByName(call.name)) {
      if (!toolLessPushbackSent) {
        toolLessPushbackSent = true;
        log.assistant('Tool-less turn called a real read tool; pushing back once before fail-open', LogLevel.WARN, {
          toolName: call.name,
        });
        host.onActivity({ toolName: call.name, status: 'error', input: call.input });
        return { callId: call.id, output: TOOL_LESS_PUSHBACK, isError: true };
      }
      log.assistant('Tool-less turn insisted after pushback; enabling the registry (triage overruled)', LogLevel.INFO, {
        toolName: call.name,
      });
      activeTools = TOOLS;
    }
    const def = activeTools.find((t) => t.name === call.name);
    if (!def) {
      // A withheld action is not the same as a typo: told "unknown tool", a
      // model retries variations of the name. Told why, it explains to the
      // user instead.
      return {
        callId: call.id,
        output: isWithheldToolName(call.name)
          ? WITHHELD_TOOL_REFUSAL
          : getToolByName(call.name)
            ? 'No tools are available for this request. Answer the user directly, in plain text.'
            : `Unknown tool: ${call.name}`,
        isError: true,
      };
    }

    // A tool called twice with identical arguments in one turn cannot return
    // anything new, so re-running it only burns iterations until the cap.
    // Observed: asked "how many people came home today", the model called
    // count_events {"interval":"1 day"} three times (that tool reports counts
    // only, never object types) and then answered from data that could not
    // contain the answer. Refusing the repeat tells it to change course
    // instead of spending the turn discovering the same result (refs #246).
    // Normalized once, here, rather than in every tool: an argument the
    // model filled with null/""/"{}" is absent from this point on.
    // count_events also gets its interval repaired: weak models echo the
    // tool's internal `{"interval":"1 day"}` shape back instead of the
    // schema's lastCount+lastUnit (observed on Apple FM and qwen).
    const stripped = stripOmittedArgs(call.input);
    const input = call.name === 'count_events' ? repairCountEventsInterval(stripped) : stripped;
    const signature = toolCallSignature(call.name, input);
    if (calledSignatures.has(signature)) {
      return {
        callId: call.id,
        output:
          `You already called ${call.name} with these exact arguments in this turn and its result is above. ` +
          'Repeating it returns the same data. Either call a DIFFERENT tool, or call this one with ' +
          'different arguments, or answer using the results you already have.',
        isError: true,
      };
    }
    calledSignatures.add(signature);

    // The refine step: reject an input the schema already rules out, before
    // any request goes out. Returned as an ordinary tool result so the model
    // corrects and retries within the same turn, which is cheaper than a
    // request that succeeds against the wrong window and answers confidently
    // from it.
    // count_events reports COUNTS ONLY and says nothing about what was
    // detected. Its own description says so, and the system prompt says so,
    // and asked "how many vehicles came today vs yesterday" the model called
    // it anyway and reported all 14 events as vehicles. Advice the model can
    // ignore is not a constraint; this one it cannot.
    const objectMismatch = objectQuestionMismatch(call.name, question, opts.objectLabels ?? []);
    if (objectMismatch) {
      log.assistant(`Tool "${call.name}" refused: cannot answer an object-type question`, LogLevel.WARN, {
        toolName: call.name,
      });
      host.onActivity({ toolName: call.name, status: 'error', input: call.input });
      return { callId: call.id, output: objectMismatch, isError: true };
    }

    const schemaError = validateToolInput(def.schema, input);
    if (schemaError) {
      log.assistant(`Tool "${call.name}" call rejected before running`, LogLevel.WARN, {
        toolName: call.name,
        input: call.input,
        error: schemaError,
      });
      host.onActivity({ toolName: call.name, status: 'error', input: call.input });
      return { callId: call.id, output: schemaError + TOOL_FAILURE_GUARD, isError: true };
    }

    // No confirmation gate here, and none needed: every tool in TOOLS is
    // read-only, and the type cannot express one that is not (see
    // ToolDefinition in types.ts). Nothing reachable from this loop mutates
    // anything, so there is no runtime decision about whether to run.
    host.onActivity({ toolName: call.name, status: 'running', input: call.input });
    try {
      // `navigate`'s `closePanel: true` needs no separate handling here: the
      // real host's `navigate()` implementation closes the panel itself as a
      // side effect of the call this makes below (see Task 9's host hook).
      const { result: r, calls: apiCalls } = await captureApiCalls(() => def.execute(input, ctx));
      trace({ kind: 'tool', name: call.name, input: call.input, output: r.output, isError: r.isError, apiCalls });
      if (!r.isError) toolOutputs.push(r.output);
      host.onActivity({ toolName: call.name, status: r.isError ? 'error' : 'done', input: call.input });
      return { callId: call.id, output: r.output, isError: r.isError, display: r.display, apiCalls };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Tool failed';
      log.assistant(`Tool "${call.name}" threw`, LogLevel.ERROR, { toolName: call.name, error: message });
      host.onActivity({ toolName: call.name, status: 'error', input: call.input });
      return { callId: call.id, output: message + TOOL_FAILURE_GUARD, isError: true };
    }
  };

  /** Handed to `provider.chat` for a backend whose runtime owns the tool loop
   *  (the apple backend today): it calls this instead of returning `toolCalls`,
   *  and every call still goes through `runOneCall`. The synthetic id keeps the
   *  results distinguishable in the one `role: 'tool'` message they land in. */
  let nativeCallCount = 0;
  const runTool = async (name: string, input: Record<string, unknown>) => {
    anyToolCallAttempted = true;
    const call: ToolCall = { id: `native-${++nativeCallCount}`, name, input };
    const result = await runOneCall(call);
    return { ...result, name, input };
  };

  for (let i = 0; i < ASSISTANT.maxToolIterations; i++) {
    if (signal.aborted) return produced;
    // Re-bound every iteration, not just at the start of the turn. Tool results
    // are appended as the turn runs, so a turn that calls several tools grew
    // well past the budget it was inside when it began: the auto-clear check
    // only acts BETWEEN turns and cannot help here.
    // No turn cap here: within a turn the loop appends correction messages
    // with `role: 'user'`, and counting those as turns would evict the
    // question being answered.
    const bounded = truncateHistory(history, ASSISTANT.maxHistoryMessages, ASSISTANT.maxHistoryCharacters);
    if (bounded.length !== history.length) history.splice(0, history.length, ...bounded);

    const rawTurn = await provider.chat(history, activeTools, system, signal, (s) => host.onStatus?.(s), runTool);
    // Slow-phase status is only meaningful while the provider is loading/prefilling; once the
    // model starts producing this round's answer, clear it so tool steps / "Thinking" show instead.
    host.onStatus?.(null);
    // Repaired here, once, for every backend: this is the single point all
    // providers pass through, and it is upstream of both the history the model
    // is replayed and the answer the user reads. `exchange` keeps the raw text
    // deliberately, so the transcript still shows what came off the wire.
    const turn = {
      ...rawTurn,
      text: rawTurn.text === undefined ? undefined : sanitizeModelText(rawTurn.text, 'answer'),
      reasoning: rawTurn.reasoning === undefined ? undefined : sanitizeModelText(rawTurn.reasoning, 'reasoning'),
    };
    if (turn.exchange) trace({ kind: 'exchange', exchange: turn.exchange });
    // Report the model's own step, not just the tool calls that follow it. A
    // turn can spend several round trips reasoning and choosing tools, and
    // without this the panel had nothing to show for any of them but
    // "Thinking", while the logs carried the model's actual working.
    if (turn.reasoning) {
      host.onActivity({ kind: 'model', detail: turn.reasoning, toolName: turn.toolCalls[0]?.name ?? '', status: 'running', input: {} });
    }
    // The SHOW directive rides on the END of the answer text and must come
    // off before anything reads it: the user never sees the line, and the
    // grounding checks judge the prose, not the machine trailer (refs #264).
    const { text: answerText, show } = turn.text ? extractShowDirective(turn.text) : { text: turn.text };
    turn.text = answerText;
    const assistantMsg: AssistantMessage = { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw };

    // A backend that ran its own tool loop (see `runTool` above) has already
    // finished iterating, so this turn is the answer. Its calls went through
    // `runOneCall`, so the activity steps and the trace entries are already
    // recorded; what is left is what the loop below does at the END of an
    // iteration: pool the result cards and put the results in history as one
    // `role: 'tool'` message, so the transcript and the persisted thread come
    // out the same shape as the loop path's (refs #270).
    if (turn.nativeToolResults?.length) {
      turnDisplay.push(...turn.nativeToolResults.flatMap((r) => r.display ?? []));
      push({ role: 'tool', toolResults: turn.nativeToolResults });
      // A native turn cut short at its tool-call budget ends with the data but
      // no prose (see chatWithNativeTools). The grounded fallback already built
      // for ungrounded retries covers it: the sentence the tool itself wrote,
      // so it cannot be wrong about the rows.
      if (!assistantMsg.text?.trim()) {
        assistantMsg.text = fallbackAnswerFromData(toolOutputs) ?? `__i18n:${PARSE_ERROR_KEY}`;
      }
      const deduped = dedupeDisplay(turnDisplay);
      assistantMsg.display = deduped && show ? filterDisplayByShow(deduped, show) : deduped;
      assistantMsg.trace = turnTrace.length > 0 ? [...turnTrace] : undefined;
      assistantMsg.usage = turn.usage;
      push(assistantMsg);
      return produced;
    }

    if (turn.toolCalls.length === 0) {
      // The grounding check, which runs for EVERY turn that fetched data,
      // independently of the optional judge above. These two faults are
      // decidable by looking at the answer, so they are decided here rather
      // than asked of a model: the judge never caught either of them, and
      // both are ways of telling the user something untrue.
      if (
        !groundingRetried &&
        turn.text &&
        !turn.text.startsWith('__i18n:') &&
        toolOutputs.length > 0 &&
        retryIsUnusable(turn.text, toolOutputs)
      ) {
        groundingRetried = true;
        log.assistant('Answer failed the grounding check, retrying once', LogLevel.WARN, {});
        history.push({ role: 'user', text: buildGroundingCorrection(turn.text, toolOutputs) });
        lastUsage = turn.usage ?? lastUsage;
        continue;
      }

      // Still ungrounded after being told exactly what was wrong. Rather than
      // ship a denial of the data or a wall of JSON, answer with the sentence
      // the tool already wrote: built from the rows in code, so it cannot be
      // wrong about them.
      if (groundingRetried && turn.text && retryIsUnusable(turn.text, toolOutputs)) {
        const grounded = fallbackAnswerFromData(toolOutputs);
        if (grounded) {
          log.assistant('Answering from the tool summary after two ungrounded attempts', LogLevel.WARN, {});
          assistantMsg.text = grounded;
        }
      }

      // The language-neutral net (see genericToolReminderSent above).
      if (
        !genericToolReminderSent &&
        activeTools.length > 0 &&
        !anyToolCallAttempted &&
        turn.text &&
        !turn.text.startsWith('__i18n:')
      ) {
        genericToolReminderSent = true;
        lastUsage = turn.usage ?? lastUsage;
        history.push({
          role: 'user',
          text:
            'If that answer states any fact about this ZoneMinder system (cameras, events, detections, server), ' +
            'call the read tool that provides it now and answer from its result. If it does not, send the same answer again.',
        });
        continue;
      }
      // De-duped, then narrowed to the cards the model's SHOW directive
      // selected (refs #264): the ids can only match cards this turn's tools
      // produced, and no directive (or one matching nothing) shows everything.
      const deduped = dedupeDisplay(turnDisplay);
      assistantMsg.display = deduped && show ? filterDisplayByShow(deduped, show) : deduped;
      assistantMsg.trace = turnTrace.length > 0 ? [...turnTrace] : undefined;
      // The last iteration's usage, not the first: each tool round-trip
      // re-sends the history plus the new tool results, so the final call has
      // the biggest prompt and is the one that says how full the window is.
      assistantMsg.usage = turn.usage;
      push(assistantMsg);
      return produced;
    }
    lastUsage = turn.usage ?? lastUsage;
    push(assistantMsg);
    anyToolCallAttempted = true;

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      if (signal.aborted) return produced;
      results.push(await runOneCall(call));
    }
    // Collect this iteration's result cards into the turn-wide pool; they are
    // NOT attached here (UI-only, never fed back to `provider.chat`). Only the
    // final assistant message below gets them, once the turn actually ends.
    turnDisplay.push(...results.flatMap((r) => r.display ?? []));
    push({ role: 'tool', toolResults: results });
  }

  push({
    role: 'assistant',
    text: `__i18n:${ITERATION_CAP_KEY}`,
    display: dedupeDisplay(turnDisplay),
    trace: turnTrace.length > 0 ? [...turnTrace] : undefined,
    usage: lastUsage,
  });
  return produced;
}
