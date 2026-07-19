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
import type { AssistantMessage, AssistantProvider, AssistantHost, DisplayEntity, TokenUsage, ToolContext, ToolResult } from './types';
import { getToolByName, isWithheldToolName, TOOLS } from './tools';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

/** Localized by the panel at render (Task 8): agent.ts never renders user-facing
 *  text itself, it only ever emits this key behind the `__i18n:` sentinel. */
const ITERATION_CAP_KEY = 'assistant.iteration_cap_reached';
const LIVE_DATA_REQUIRED_KEY = 'assistant.live_data_required';

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

interface ReadToolRequirement {
  names: readonly string[];
  reminder: string;
}

/**
 * Matches English only, deliberately.
 *
 * The obvious "fix" is keyword lists per language, and it is worse than
 * nothing: the terms are guesses at how someone phrases a question rather than
 * translated UI strings, no word list ever covers a language (a German user
 * can ask about events without using any noun on the list), and the collisions
 * are silent (French "hier" = yesterday, German "hier" = here, so a German
 * greeting would trip an events guard).
 *
 * The on-device model is an English-first 2B reasoning distill emitting a
 * strict JSON contract, so English is the path we actually support. The app
 * tells the user that outright when it is running on-device in another
 * language (see AskPanel's language notice) rather than implying, through a
 * half-working guard, that every language is equally supported.
 */
function requiredReadTool(history: AssistantMessage[]): ReadToolRequirement | undefined {
  const request = [...history].reverse().find((message) => message.role === 'user')?.text ?? '';
  if (/\b(?:summar(?:y|i[sz]e)|recap|overview)\b.{0,80}\b(?:day|today|events?|activity)\b|\b(?:day|today)\b.{0,80}\b(?:summar(?:y|i[sz]e)|recap|overview)\b/i.test(request)) {
    return {
      names: ['list_events'],
      reminder: 'Daily-summary requirement: call list_events with {"range":"today"} now. Do not answer until its result is available.',
    };
  }
  if (/\b(?:server|health)\b/i.test(request)) {
    return { names: ['get_server_health'], reminder: 'Live-data requirement: call get_server_health now. Do not answer until its result is available.' };
  }
  if (/\b(?:event|events?|detection|detections?|activity|activities|today|yesterday)\b/i.test(request)) {
    return { names: ['list_events', 'count_events'], reminder: 'Live-data requirement: call list_events or count_events now. Do not answer until its result is available.' };
  }
  if (/\b(?:camera|cameras|monitor|monitors?|status|armed|disarmed|fps)\b/i.test(request)) {
    return { names: ['list_monitors', 'get_monitor'], reminder: 'Live-data requirement: call list_monitors or get_monitor now. Do not answer until its result is available.' };
  }
  return undefined;
}

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
function messageCharacters(message: AssistantMessage): number {
  return (message.text?.length ?? 0) + (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0) +
    (message.toolResults ? JSON.stringify(message.toolResults).length : 0);
}

export function truncateHistory(history: AssistantMessage[], max: number, maxCharacters = Number.POSITIVE_INFINITY): AssistantMessage[] {
  const tail: AssistantMessage[] = [];
  let characters = 0;
  for (let i = history.length - 1; i >= 0 && tail.length < max; i--) {
    const message = history[i];
    const size = messageCharacters(message);
    if (tail.length > 0 && characters + size > maxCharacters) break;
    tail.unshift(message);
    characters += size;
  }
  while (tail.length && tail[0].role === 'tool') tail.shift();
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
  // Boundary slice BEFORE the message-count truncation: the cap counts what
  // the model will actually be sent, so a pre-boundary message must never
  // occupy one of those slots.
  const history = truncateHistory(
    sliceAfterContextBoundary(opts.history),
    ASSISTANT.maxHistoryMessages,
    ASSISTANT.maxHistoryCharacters,
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
  /** Usage from the most recent `provider.chat` that reported any, so the
   *  iteration-cap message below can still tell AskPanel how full the window
   *  got: a turn that burns every iteration is exactly the kind that fills it. */
  let lastUsage: TokenUsage | undefined;
  const readToolRequirement = requiredReadTool(history);
  let requiredReadToolComplete = false;
  let requiredReadToolReminderSent = false;
  /** `name:JSON(input)` for every tool call attempted this turn, so an
   *  identical repeat can be refused rather than re-run (see the loop below). */
  const calledSignatures = new Set<string>();

  for (let i = 0; i < ASSISTANT.maxToolIterations; i++) {
    if (signal.aborted) return produced;
    const turn = await provider.chat(history, TOOLS, system, signal);
    const assistantMsg: AssistantMessage = { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw };

    if (turn.toolCalls.length === 0) {
      if (readToolRequirement && !requiredReadToolComplete) {
        lastUsage = turn.usage ?? lastUsage;
        if (!requiredReadToolReminderSent) {
          requiredReadToolReminderSent = true;
          history.push({ role: 'user', text: readToolRequirement.reminder });
          continue;
        }
        push({ role: 'assistant', text: `__i18n:${LIVE_DATA_REQUIRED_KEY}`, usage: lastUsage });
        return produced;
      }
      assistantMsg.display = dedupeDisplay(turnDisplay);
      // The last iteration's usage, not the first: each tool round-trip
      // re-sends the history plus the new tool results, so the final call has
      // the biggest prompt and is the one that says how full the window is.
      assistantMsg.usage = turn.usage;
      push(assistantMsg);
      return produced;
    }
    lastUsage = turn.usage ?? lastUsage;
    push(assistantMsg);

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      if (signal.aborted) return produced;
      const def = getToolByName(call.name);
      if (!def) {
        // A withheld action is not the same as a typo: told "unknown tool", a
        // model retries variations of the name. Told why, it explains to the
        // user instead.
        results.push({
          callId: call.id,
          output: isWithheldToolName(call.name) ? WITHHELD_TOOL_REFUSAL : `Unknown tool: ${call.name}`,
          isError: true,
        });
        continue;
      }

      // A tool called twice with identical arguments in one turn cannot return
      // anything new, so re-running it only burns iterations until the cap.
      // Observed: asked "how many people came home today", the model called
      // count_events {"interval":"1 day"} three times (that tool reports counts
      // only, never object types) and then answered from data that could not
      // contain the answer. Refusing the repeat tells it to change course
      // instead of spending the turn discovering the same result (refs #246).
      const signature = `${call.name}:${JSON.stringify(call.input)}`;
      if (calledSignatures.has(signature)) {
        results.push({
          callId: call.id,
          output:
            `You already called ${call.name} with these exact arguments in this turn and its result is above. ` +
            'Repeating it returns the same data. Either call a DIFFERENT tool, or call this one with ' +
            'different arguments, or answer using the results you already have.',
          isError: true,
        });
        continue;
      }
      calledSignatures.add(signature);

      // No confirmation gate here, and none needed: every tool in TOOLS is
      // read-only, and the type cannot express one that is not (see
      // ToolDefinition in types.ts). Nothing reachable from this loop mutates
      // anything, so there is no runtime decision about whether to run.
      host.onActivity({ toolName: call.name, status: 'running', input: call.input });
      try {
        // `navigate`'s `closePanel: true` needs no separate handling here: the
        // real host's `navigate()` implementation closes the panel itself as a
        // side effect of the call this makes below (see Task 9's host hook).
        const r = await def.execute(call.input, ctx);
        results.push({ callId: call.id, output: r.output, isError: r.isError, display: r.display });
        if (readToolRequirement?.names.includes(call.name) && !r.isError) requiredReadToolComplete = true;
        host.onActivity({ toolName: call.name, status: r.isError ? 'error' : 'done', input: call.input });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Tool failed';
        log.assistant(`Tool "${call.name}" threw`, LogLevel.ERROR, { toolName: call.name, error: e });
        results.push({ callId: call.id, output: message, isError: true });
        host.onActivity({ toolName: call.name, status: 'error', input: call.input });
      }
    }
    // Collect this iteration's result cards into the turn-wide pool; they are
    // NOT attached here (UI-only, never fed back to `provider.chat`). Only the
    // final assistant message below gets them, once the turn actually ends.
    turnDisplay.push(...results.flatMap((r) => r.display ?? []));
    push({ role: 'tool', toolResults: results });
  }

  push({
    role: 'assistant',
    text: `__i18n:${readToolRequirement && !requiredReadToolComplete ? LIVE_DATA_REQUIRED_KEY : ITERATION_CAP_KEY}`,
    display: dedupeDisplay(turnDisplay),
    usage: lastUsage,
  });
  return produced;
}
