/**
 * Shared helpers for assistant tool executors (refs #246).
 *
 * Split out of tools.ts so tools-readonly.ts and tools-destructive.ts can
 * both use them without pulling each other in.
 */
import { log, LogLevel } from '../logger';
import { ASSISTANT } from '../zmninja-ng-constants';
import type { DisplayEntity, ToolExecuteResult } from './types';

/** Literal strings a model emits for an OPTIONAL argument it means to leave
 *  out. Small models routinely send `"null"` (or `"undefined"`, `"none"`,
 *  `"all"`, `"any"`, `""`) instead of omitting the key, so a tool must read
 *  these as "no value" rather than a real one, or it queries for a monitor
 *  named "null" and fails (refs #246). */
const OMITTED_ARG_VALUES = new Set(['', 'null', 'undefined', 'none', 'n/a', 'na', 'all', 'any']);

/** Whether a model-supplied optional argument should be treated as absent.
 *  True for undefined/null and for the placeholder strings above. */
export function isOmittedArg(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return OMITTED_ARG_VALUES.has(String(value).trim().toLowerCase());
}

/** Routes the assistant may send the user to. Anything else is rejected
 *  before `ctx.host.navigate` is ever called. */
export const NAVIGATE_ALLOWLIST = [
  /^\/monitors$/, /^\/monitors\/[^/]+$/, /^\/events$/, /^\/events\/[^/]+$/,
  /^\/montage$/, /^\/timeline$/, /^\/dashboard$/, /^\/server$/,
];

/** A tool's `run` callback may return a bare output string, or (refs #246)
 *  an output plus UI-only result cards for the ones that look up events or
 *  monitors. Deliberately no `isError`: throwing is the only way to produce an
 *  error result (see `safeExecute`), so a `run` that wants the model to see a
 *  failure must throw rather than return. */
export interface SafeExecuteOutput {
  output: string;
  display?: DisplayEntity[];
}

/** Runs `run`, turning a thrown error into an `isError` result instead of
 *  letting it escape into the agent loop. */
export async function safeExecute(
  name: string,
  run: () => Promise<string | SafeExecuteOutput>,
): Promise<ToolExecuteResult> {
  try {
    const result = await run();
    const output = typeof result === 'string' ? result : result.output;
    const boundedOutput =
      output.length <= ASSISTANT.maxToolResultCharacters
        ? output
        : JSON.stringify({
            truncated: true,
            message: 'Tool output exceeded the context budget. Use a narrower filter or fetch one item.',
            preview: output.slice(0, ASSISTANT.maxToolResultCharacters - 200),
          });
    return typeof result === 'string'
      ? { output: boundedOutput }
      : { output: boundedOutput, display: result.display };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.assistant(`Tool "${name}" failed`, LogLevel.ERROR, { error: err });
    return { output: message, isError: true };
  }
}
