/**
 * Agent tool-use loop (refs #246).
 *
 * The single choke point for destructive tool execution: `host.confirm` is
 * the only call on the path from a model-issued `ToolCall` to `def.execute`
 * for a destructive tool. There is no other branch that reaches `execute`
 * for such a tool (see the `if (def.destructive)` block below): every
 * destructive call either resolves confirm `true` first, or is short-circuited
 * to the fixed "declined" result and never runs.
 */
import type { AssistantMessage, AssistantProvider, AssistantHost, DisplayEntity, TokenUsage, ToolContext, ToolResult } from './types';
import { getToolByName, TOOLS } from './tools';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

/** Localized by the panel at render (Task 8): agent.ts never renders user-facing
 *  text itself, it only ever emits this key behind the `__i18n:` sentinel. */
const ITERATION_CAP_KEY = 'assistant.iteration_cap_reached';

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

  for (let i = 0; i < ASSISTANT.maxToolIterations; i++) {
    if (signal.aborted) return produced;
    const turn = await provider.chat(history, TOOLS, system, signal);
    const assistantMsg: AssistantMessage = { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw };

    if (turn.toolCalls.length === 0) {
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
        results.push({ callId: call.id, output: `Unknown tool: ${call.name}`, isError: true });
        continue;
      }

      // The confirm gate: the ONLY path to `def.execute` for a destructive tool
      // is through `host.confirm` resolving `true`. A thrown or false-resolving
      // confirm (including one interrupted by abort, via `.catch(() => false)`)
      // short-circuits to the fixed decline result and `continue`s past `execute`.
      if (def.destructive) {
        let req;
        try {
          req = def.buildConfirm
            ? await def.buildConfirm(call.input, ctx)
            : { toolName: def.name, messageKey: 'assistant.confirm.generic', messageParams: {}, params: call.input };
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Failed to prepare confirmation';
          log.assistant(`buildConfirm for "${call.name}" threw`, LogLevel.ERROR, { toolName: call.name, error: e });
          results.push({ callId: call.id, output: message, isError: true });
          host.onActivity({ toolName: call.name, status: 'error', input: call.input });
          continue;
        }
        const ok = await host.confirm(req).catch(() => false);
        if (!ok) {
          log.assistant(`Destructive tool "${call.name}" declined`, LogLevel.INFO, { toolName: call.name });
          results.push({ callId: call.id, output: 'User declined this action.' });
          continue;
        }
      }

      host.onActivity({ toolName: call.name, status: 'running', input: call.input });
      try {
        // `navigate`'s `closePanel: true` needs no separate handling here: the
        // real host's `navigate()` implementation closes the panel itself as a
        // side effect of the call this makes below (see Task 9's host hook).
        const r = await def.execute(call.input, ctx);
        results.push({ callId: call.id, output: r.output, isError: r.isError, display: r.display });
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
    text: `__i18n:${ITERATION_CAP_KEY}`,
    display: dedupeDisplay(turnDisplay),
    usage: lastUsage,
  });
  return produced;
}
