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
    'Rules: answer only from tool results, never invent ids, prefer the navigate tool after finding results, ' +
      'keep answers short and directly answer what was asked.',
    'Never ask the user for information a tool can obtain, and never ask for a monitor id: monitorId is ' +
      'optional on the event tools. If the user asks about "all events", "all monitors", or names no ' +
      'monitor, call the tool WITHOUT a monitorId to query across every monitor.',
    'For "summarize", "how many", or "most active" events today or in the last 24 hours, call count_events ' +
      'with the matching interval (e.g. "1 day" or "24 hour") to get per-monitor counts, then summarize ' +
      'across monitors in your answer.',
    'Prefer calling a tool over asking a clarifying question. Only ask the user if the request is genuinely ' +
      'ambiguous and no tool can resolve it.',
    'Monitors (id: name):',
    monitorLines,
  ].join('\n');
}
