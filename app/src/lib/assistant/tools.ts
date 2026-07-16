/**
 * Assistant tool registry (refs #246).
 *
 * Read-only tools live in tools-readonly.ts, and shared executor helpers
 * live in tool-helpers.ts. This file is only the barrel: it assembles TOOLS
 * and resolves a tool by name. Destructive tools land here in a follow-up.
 */
import { readOnlyTools } from './tools-readonly';
import type { ToolDefinition } from './types';

export { readOnlyTools } from './tools-readonly';

export const TOOLS: ToolDefinition[] = [...readOnlyTools];

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
