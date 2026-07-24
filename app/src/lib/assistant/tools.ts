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
 * The same tools with `objectType` pinned to the labels this install records.
 *
 * Observed on the Apple Intelligence backend (refs #270): asked for plain
 * event counts, the model called `list_events` with objectType "summary",
 * which is not a label any detector writes. The executor rejected it and named
 * the real labels (car, person, truck), the model tried more invented
 * variants, and the turn spent its whole iteration budget without answering.
 * The registry declares objectType as a free string, so guided decoding had
 * nothing to hold it to and the correction could only ever arrive after the
 * fact.
 *
 * Injecting the install's labels as an `enum` makes it structural instead: the
 * Apple schema converter turns an enum into decoder choices, so a label that
 * does not exist can no longer be generated. The registry itself stays generic
 * (evals and other callers run without an install), and both accepted shapes
 * survive: one label, or an array of them for a category word.
 *
 * `type` and `items` are left in place next to the added `anyOf` so the
 * pre-flight validator (`validateToolInput`) and the WebLLM signature line
 * still read the property exactly as they did before.
 *
 * No labels known (a fresh install, or the sample failed) returns `tools`
 * unchanged.
 */
export function specializeToolSchemas(
  tools: ToolDefinition[],
  objectLabels: readonly string[] | undefined,
): ToolDefinition[] {
  const labels = (objectLabels ?? []).filter((label) => label.trim() !== '');
  if (labels.length === 0) return tools;
  return tools.map((tool) => {
    const properties = (tool.schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const spec = properties.objectType;
    if (!spec) return tool;
    const types = (Array.isArray(spec.type) ? spec.type : spec.type ? [spec.type] : []) as string[];
    const branches = [
      ...(types.includes('string') ? [{ type: 'string', enum: [...labels] }] : []),
      ...(types.includes('array') ? [{ type: 'array', items: { type: 'string', enum: [...labels] } }] : []),
    ];
    if (branches.length === 0) return tool;
    return {
      ...tool,
      schema: {
        ...tool.schema,
        properties: { ...properties, objectType: { ...spec, anyOf: branches } },
      },
    };
  });
}

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
  'navigate',
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
