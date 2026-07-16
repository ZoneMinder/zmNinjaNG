/**
 * Assistant tool registry (refs #246).
 *
 * Read-only tools live in tools-readonly.ts, destructive tools (each
 * requiring host confirmation) live in tools-destructive.ts, and shared
 * executor helpers live in tool-helpers.ts. This file is only the barrel:
 * it assembles TOOLS and resolves a tool by name.
 */
import { readOnlyTools } from './tools-readonly';
import { destructiveTools } from './tools-destructive';
import type { ToolDefinition } from './types';

export { readOnlyTools } from './tools-readonly';
export { destructiveTools } from './tools-destructive';

export const TOOLS: ToolDefinition[] = [...readOnlyTools, ...destructiveTools];

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
