/**
 * Assistant tool registry (refs #246).
 *
 * Read-only tools live in tools-readonly.ts and shared executor helpers live
 * in tool-helpers.ts. This file is only the barrel: it assembles TOOLS and
 * resolves a tool by name.
 */
import { readOnlyTools } from './tools-readonly';
import type { ToolDefinition } from './types';

export { readOnlyTools } from './tools-readonly';

/**
 * Every tool the assistant can run. Read-only by construction, on every
 * backend.
 *
 * The assistant used to be able to arm and disarm monitors, change the run
 * state and monitor functions, trigger alarms, and delete or archive events,
 * each behind a confirmation dialog. That made a single tap the whole defence
 * against a model misreading a request, and `delete_event` could not be
 * undone.
 *
 * The guarantee here is structural, not a matter of the model behaving: the
 * tools that performed those actions no longer exist, so nothing in the
 * assistant imports `deleteEvent`, `setMonitorEnabled`, `changeState`, or any
 * other mutating API. There is no flag to flip and no prompt to jailbreak. The
 * app's own screens still do all of it; the user picks the target there.
 */
export const TOOLS: ToolDefinition[] = [...readOnlyTools];

/**
 * Names the assistant used to expose, kept ONLY so the agent loop can explain
 * itself when a model asks for one (they appear in model training data and in
 * older conversations). This is a list of strings, deliberately not a registry
 * of callables: there is no implementation behind any of them.
 */
export const WITHHELD_TOOL_NAMES: readonly string[] = [
  'trigger_alarm',
  'cancel_alarm',
  'set_monitor_enabled',
  'change_monitor_function',
  'change_run_state',
  'delete_event',
  'archive_event',
];

/** Whether `name` is a withheld action, so the agent loop can say why it will
 *  not run rather than reporting an unknown tool (which reads to the model
 *  like a typo worth retrying). */
export function isWithheldToolName(name: string): boolean {
  return WITHHELD_TOOL_NAMES.includes(name);
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
