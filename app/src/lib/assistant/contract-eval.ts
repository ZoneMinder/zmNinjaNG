/**
 * On-device tool-contract eval (refs #270).
 *
 * The companion to `fm-eval.ts`, and the more important of the two. That one
 * measures time understanding through `provider.complete`; this one measures the
 * thing the assistant is actually judged on: given a question and the tool
 * catalog, does the backend pick the right tool with the right arguments.
 *
 * It exists because `scripts/prompt-eval.mts` scores exactly this over HTTP and so
 * can only ever reach Ollama. Neither system model has an HTTP surface, so before
 * this neither Apple Foundation Models nor Gemini Nano had a number on the one
 * axis the backend ranking claims to rank them by.
 *
 * The cases are the harness's own (`contract-eval-cases.ts`), and the prompt is
 * built with the production `buildSystemPrompt` and handed to `provider.chat`, so
 * each backend is measured through its REAL path: Apple's native tool loop and
 * trimmed instructions, Gemini Nano's textual envelope and self-repair retries.
 * Nothing here reimplements a prompt.
 */
import { buildSystemPrompt } from './system-prompt';
import { TOOLS } from './tools';
import { stripOmittedArgs, coerceLabelList } from './tool-helpers';
import { TOOL_CASES, CONTRACT_EVAL_OBJECT_LABELS, type ToolCase } from './contract-eval-cases';
import type { AssistantProvider, ExecutedToolCall, ToolCall } from './types';
import { log, LogLevel } from '../logger';

/** How many cases this eval actually scores. Exported so a caller running it
 *  alongside another stage knows the combined total BEFORE either starts, and can
 *  show one progress bar that does not reach 100% and then jump back. */
export const CONTRACT_EVAL_CASE_COUNT = TOOL_CASES.filter((c) => !c.triaged).length;

/** One case that did not meet its expectation, kept compact for the log line. */
export interface ContractEvalFailure {
  q: string;
  /** The tool the case expects, or 'none' for a no-tool case. */
  expected: string;
  /** What the backend actually did: the call it made, or why there was none. */
  got: string;
}

export interface ContractEvalReport {
  pass: number;
  total: number;
  /** Cases triage answers before the prompt sees them: reported, never scored,
   *  exactly as `prompt-eval.mts` treats them. */
  skippedTriaged: number;
  failures: ContractEvalFailure[];
  durationMs: number;
}

/** A tool result shaped like a real one, handed back to a backend that runs its
 *  own tool loop so the turn can finish. Only the shape matters: the eval scores
 *  the CALL, never the prose that follows it. */
function cannedResult(name: string, input: Record<string, unknown>): ExecutedToolCall {
  return {
    callId: `eval-${name}`,
    name,
    input,
    output: JSON.stringify({ summary: '3 events matched.', matchCount: 3, events: [] }),
  };
}

/** Normalizes arguments the way the agent does before validation, so a case's
 *  predicate sees what a tool would have seen rather than the raw model output. */
function normalizeArgs(input: Record<string, unknown>): Record<string, unknown> {
  const args = stripOmittedArgs(input);
  if (args.objectType !== undefined) args.objectType = coerceLabelList(args.objectType);
  return args;
}

/** Scores one case against the calls a backend produced. Returns undefined when
 *  the case passes, or the reason it failed. */
function scoreCase(c: ToolCase, calls: Array<{ name: string; input: Record<string, unknown> }>): string | undefined {
  if (c.tool === null) {
    return calls.length === 0 ? undefined : `called ${calls.map((x) => x.name).join(', ')}`;
  }
  if (calls.length === 0) return 'no tool call';
  // `allCalls` cases fail if ANY call is wrong: on "compare may to june" a stray
  // objectType on the second call corrupts the answer just as badly as on the first.
  const checked = c.allCalls ? calls : calls.slice(0, 1);
  for (const call of checked) {
    if (call.name !== c.tool) return `called ${call.name}`;
    if (c.args && !c.args(normalizeArgs(call.input))) return `args ${JSON.stringify(normalizeArgs(call.input))}`;
  }
  return undefined;
}

/**
 * Runs every scored case through `provider.chat` and returns the tally.
 *
 * `runTool` is supplied deliberately. A backend that owns its tool loop (Apple)
 * only reveals its calls by executing them, so without this the eval would score
 * that backend's fallback path instead of the one production uses. Backends that
 * return `toolCalls` ignore the callback, and both sources are read below.
 *
 * Never throws for a single case: a backend that rejects one question is scored as
 * failing that case and the run continues, because a run that dies on case three
 * measures nothing.
 */
export async function runContractEval(
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<ContractEvalReport> {
  const startedAt = Date.now();
  const system = buildSystemPrompt({
    now,
    timezone,
    zmVersion: '1.39.1',
    locale: 'en-US',
    objectLabels: CONTRACT_EVAL_OBJECT_LABELS,
  } as never);

  const scored = TOOL_CASES.filter((c) => !c.triaged);
  const failures: ContractEvalFailure[] = [];
  let pass = 0;
  let done = 0;

  for (const c of scored) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const executed: Array<{ name: string; input: Record<string, unknown> }> = [];
    let reason: string | undefined;
    try {
      const turn = await provider.chat([{ role: 'user', text: c.q }], TOOLS, system, signal, undefined, async (name, input) => {
        executed.push({ name, input });
        return cannedResult(name, input);
      });
      // A backend that ran its own loop reports through `executed`; one that
      // returns calls for the agent to run reports through `toolCalls`.
      const calls = executed.length > 0 ? executed : turn.toolCalls.map((tc: ToolCall) => ({ name: tc.name, input: tc.input }));
      reason = scoreCase(c, calls);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      reason = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (reason === undefined) pass += 1;
    else failures.push({ q: c.q, expected: c.tool ?? 'none', got: reason });
    onProgress?.(++done, scored.length);
  }

  const report: ContractEvalReport = {
    pass,
    total: scored.length,
    skippedTriaged: TOOL_CASES.length - scored.length,
    failures,
    durationMs: Date.now() - startedAt,
  };
  log.assistant('Contract eval finished', LogLevel.INFO, { pass: report.pass, total: report.total });
  return report;
}
