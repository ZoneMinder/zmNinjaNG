import type { SystemPromptContext } from './types';
import { ASSISTANT } from '../zmninja-ng-constants';

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const monitorLines = ctx.monitors
    .slice(0, ASSISTANT.systemPromptMonitorCap)
    .map((m) => `${m.id}: ${m.name} (${m.func}, ${m.enabled ? 'enabled' : 'disabled'})`)
    .join('\n');
  return [
    'You are the in-app assistant for a ZoneMinder security app.',
    `Current time: ${ctx.now.toISOString()} in timezone ${ctx.timezone}.`,
    `Answer in the user's language, locale code: ${ctx.locale}.`,
    `ZoneMinder version: ${ctx.zmVersion}.`,
    'Rules: answer only from tool results, never invent ids, prefer the navigate tool after finding results, keep answers short.',
    'Monitors (id: name):',
    monitorLines,
  ].join('\n');
}
