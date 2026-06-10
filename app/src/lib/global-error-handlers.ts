/**
 * Global Error Sinks
 *
 * Window-level listeners for 'unhandledrejection' and 'error' that route
 * otherwise-lost async failures into the in-app log system (lib/logger.ts),
 * so they show up on the Logs page and in exported log files.
 *
 * The listeners never call preventDefault: browser console reporting of
 * uncaught errors stays unchanged. refs #182.
 */

import { log, LogLevel } from './logger';
import { LOGGING } from './zmninja-ng-constants';

let installed = false;

function truncateStack(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || stack.length === 0) return undefined;
  if (stack.length <= LOGGING.maxStackLength) return stack;
  return `${stack.slice(0, LOGGING.maxStackLength)}... (truncated)`;
}

function describeReason(reason: unknown): { reason: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      reason: `${reason.name}: ${reason.message}`,
      stack: truncateStack(reason.stack),
    };
  }
  if (typeof reason === 'string') return { reason };
  try {
    // JSON.stringify(undefined) yields undefined; fall back to String().
    return { reason: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { reason: String(reason) };
  }
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  log.app('Unhandled promise rejection', LogLevel.ERROR, describeReason(event.reason));
}

function handleWindowError(event: ErrorEvent): void {
  log.app('Uncaught window error', LogLevel.ERROR, {
    message: event.message,
    source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    stack: truncateStack(event.error instanceof Error ? event.error.stack : undefined),
  });
}

/** Register both listeners. Safe to call more than once. */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleWindowError);
  installed = true;
}

/** Remove the listeners. Used by tests. */
export function uninstallGlobalErrorHandlers(): void {
  if (!installed) return;
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  window.removeEventListener('error', handleWindowError);
  installed = false;
}
