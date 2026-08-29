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
import { TOOLS, withServerArg } from './tools';
import { stripOmittedArgs, coerceLabelList } from './tool-helpers';
import {
  TOOL_CASES,
  SERVER_TOOL_CASES,
  SERVER_EVAL_SERVERS,
  CONTRACT_EVAL_OBJECT_LABELS,
  type ToolCase,
} from './contract-eval-cases';
import type { AssistantProvider, ExecutedToolCall, ToolCall } from './types';
import { log, LogLevel } from '../logger';
import { isAbortError } from '../is-abort-error';

/** How many cases this eval actually scores. Exported so a caller running it
 *  alongside another stage knows the combined total BEFORE either starts, and can
 *  show one progress bar that does not reach 100% and then jump back. */
export const CONTRACT_EVAL_CASE_COUNT = TOOL_CASES.length + SERVER_TOOL_CASES.length;

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
  /** How many scored cases expect NO tool call. Reported so a reader can see the
   *  benchmark's balance between "fetch the right thing" and "fetch nothing". */
  noToolCases: number;
  /** How many calls AICore rate-limited and this runner retried. Non-zero means the
   *  run was paced by the platform, which is worth seeing next to the score. */
  rateLimitedRetries: number;
  failures: ContractEvalFailure[];
  durationMs: number;
}

/** Waits for AICore's short-window rate limit to clear. Two attempts at widening
 *  gaps: the limit is a burst limit, not a daily one, so a pause is enough. */
const RATE_LIMIT_BACKOFF_MS = [3000, 8000];

/** Whether an error is AICore telling us to slow down rather than a real failure.
 *  `GeminiNanoProvider` tags it (see its `mapPluginError`); every other backend
 *  has nothing like it, so this is simply never true there. */
function isRateLimit(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'RATE_LIMITED';
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

  // The same prompt and registry a turn inside a server group gets (refs #337):
  // the roster line plus the `server` argument, pinned to those names. Built
  // once, used only by the group cases below.
  const scopedSystem = buildSystemPrompt({
    now,
    timezone,
    zmVersion: '1.39.1',
    locale: 'en-US',
    objectLabels: CONTRACT_EVAL_OBJECT_LABELS,
    servers: SERVER_EVAL_SERVERS,
  } as never);
  const scopedTools = withServerArg(TOOLS, SERVER_EVAL_SERVERS);
  const isScoped = (c: ToolCase) => SERVER_TOOL_CASES.includes(c);

  // Every case, including the ones triage would intercept in production: deciding
  // that NO lookup is needed is half of planning, and skipping those measured only
  // the half the model finds easier.
  const scored = [...TOOL_CASES, ...SERVER_TOOL_CASES];
  const failures: ContractEvalFailure[] = [];
  let pass = 0;
  let done = 0;
  let rateLimited = 0;

  for (const c of scored) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let reason: string | undefined;
    // A rate-limited call is not an answer, so it must not be scored as a wrong
    // one. Running this eval straight after the time eval did exactly that once:
    // AICore rate-limited every case and the stage reported 0/14 as if the model
    // had failed all of them.
    for (let attempt = 0; ; attempt++) {
      const executed: Array<{ name: string; input: Record<string, unknown> }> = [];
      try {
        const caseTools = isScoped(c) ? scopedTools : TOOLS;
        const caseSystem = isScoped(c) ? scopedSystem : system;
        const turn = await provider.chat([{ role: 'user', text: c.q }], caseTools, caseSystem, signal, undefined, async (name, input) => {
          executed.push({ name, input });
          return cannedResult(name, input);
        });
        // A backend that ran its own loop reports through `executed`; one that
        // returns calls for the agent to run reports through `toolCalls`.
        const calls = executed.length > 0 ? executed : turn.toolCalls.map((tc: ToolCall) => ({ name: tc.name, input: tc.input }));
        reason = scoreCase(c, calls);
        break;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (isRateLimit(error) && attempt < RATE_LIMIT_BACKOFF_MS.length) {
          rateLimited += 1;
          await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS[attempt]));
          continue;
        }
        reason = `error: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
    if (reason === undefined) pass += 1;
    else failures.push({ q: c.q, expected: c.tool ?? 'none', got: reason });
    onProgress?.(++done, scored.length);
  }

  const report: ContractEvalReport = {
    pass,
    total: scored.length,
    noToolCases: TOOL_CASES.filter((c) => c.tool === null).length,
    rateLimitedRetries: rateLimited,
    failures,
    durationMs: Date.now() - startedAt,
  };
  log.assistant('Contract eval finished', LogLevel.INFO, { pass: report.pass, total: report.total });
  return report;
}
