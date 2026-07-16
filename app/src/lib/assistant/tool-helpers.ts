/**
 * Shared helpers for assistant tool executors (refs #246).
 *
 * Split out of tools.ts so tools-readonly.ts and tools-destructive.ts can
 * both use them without pulling each other in.
 */
import { log, LogLevel } from '../logger';
import type { DisplayEntity, ToolExecuteResult } from './types';

/** Routes the assistant may send the user to. Anything else is rejected
 *  before `ctx.host.navigate` is ever called. */
export const NAVIGATE_ALLOWLIST = [
  /^\/monitors$/, /^\/monitors\/[^/]+$/, /^\/events$/, /^\/events\/[^/]+$/,
  /^\/montage$/, /^\/timeline$/, /^\/dashboard$/, /^\/server$/,
];

/** A tool's `run` callback may return a bare output string, or (refs #246)
 *  an output plus UI-only result cards for the ones that look up events or
 *  monitors. */
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
    return typeof result === 'string' ? { output: result } : { output: result.output, display: result.display };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.assistant(`Tool "${name}" failed`, LogLevel.ERROR, { error: err });
    return { output: message, isError: true };
  }
}
