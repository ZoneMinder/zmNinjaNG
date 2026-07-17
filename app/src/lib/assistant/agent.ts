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
import type { AssistantMessage, AssistantProvider, AssistantHost, DisplayEntity, ToolContext, ToolResult } from './types';
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
export function truncateHistory(history: AssistantMessage[], max: number): AssistantMessage[] {
  const tail = history.slice(-max);
  while (tail.length && tail[0].role === 'tool') tail.shift();
  return tail;
}

export interface RunOpts {
  provider: AssistantProvider;
  host: AssistantHost;
  ctx: ToolContext;
  history: AssistantMessage[];
  system: string;
  signal: AbortSignal;
}

export async function runAssistantTurn(opts: RunOpts): Promise<AssistantMessage[]> {
  const { provider, host, ctx, system, signal } = opts;
  const history = truncateHistory(opts.history, ASSISTANT.maxHistoryMessages);
  // Cards accumulate across every tool-calling iteration of this turn and land
  // on the FINAL assistant answer message only (never an intermediate
  // tool-call-only assistant message or a `role: 'tool'` message), so AskPanel
  // renders question -> steps -> answer text -> cards (refs #246).
  const turnDisplay: DisplayEntity[] = [];

  for (let i = 0; i < ASSISTANT.maxToolIterations; i++) {
    if (signal.aborted) return history;
    const turn = await provider.chat(history, TOOLS, system, signal);
    const assistantMsg: AssistantMessage = { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw };

    if (turn.toolCalls.length === 0) {
      assistantMsg.display = dedupeDisplay(turnDisplay);
      history.push(assistantMsg);
      return history;
    }
    history.push(assistantMsg);

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      if (signal.aborted) return history;
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
    history.push({ role: 'tool', toolResults: results });
  }

  history.push({ role: 'assistant', text: `__i18n:${ITERATION_CAP_KEY}`, display: dedupeDisplay(turnDisplay) });
  return history;
}
