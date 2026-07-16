/**
 * Shared helpers for assistant tool executors (refs #246).
 *
 * Split out of tools.ts so tools-readonly.ts and tools-destructive.ts can
 * both use them without pulling each other in.
 */
import { log, LogLevel } from '../logger';
import type { ToolExecuteResult } from './types';

/** Routes the assistant may send the user to. Anything else is rejected
 *  before `ctx.host.navigate` is ever called. */
export const NAVIGATE_ALLOWLIST = [
  /^\/monitors$/, /^\/monitors\/[^/]+$/, /^\/events$/, /^\/events\/[^/]+$/,
  /^\/montage$/, /^\/timeline$/, /^\/dashboard$/, /^\/server$/,
];

/** Runs `run`, turning a thrown error into an `isError` result instead of
 *  letting it escape into the agent loop. */
export async function safeExecute(name: string, run: () => Promise<string>): Promise<ToolExecuteResult> {
  try {
    return { output: await run() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.assistant(`Tool "${name}" failed`, LogLevel.ERROR, { error: err });
    return { output: message, isError: true };
  }
}
