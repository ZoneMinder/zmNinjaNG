/**
 * The previous-exchange context that rides the parse, coverage, and time
 * calls (refs #440, #444), and the helpers that build it. A module of its
 * own because triage imports the timeframe stage, and the stage needs these
 * too: the graph must stay acyclic.
 */
import { ASSISTANT } from '../zmninja-ng-constants';

/** The previous completed exchange, for classifying a follow-up (refs #440):
 *  "yes" or "what about the garage?" is unreadable without it. */
export interface ParseContext {
  user: string;
  assistant: string;
}

/** The latest completed user+assistant exchange BEFORE the message currently
 *  being classified, or undefined on a fresh thread. */
export function latestExchange(history: ReadonlyArray<{ role: string; text?: string }>): ParseContext | undefined {
  for (let i = history.length - 1; i >= 1; i--) {
    const assistant = history[i];
    if (assistant.role !== 'assistant' || !assistant.text) continue;
    for (let j = i - 1; j >= 0; j--) {
      const user = history[j];
      if (user.role === 'user' && user.text) return { user: user.text, assistant: assistant.text };
    }
    return undefined;
  }
  return undefined;
}

/** The question as the parse and coverage calls receive it: bare, or wrapped
 *  with the previous exchange so a short follow-up carries its topic. Both
 *  turns are trimmed hard - the context is a hint, not a transcript. */
export function buildContextualQuestion(question: string, context?: ParseContext): string {
  if (!context) return question;
  const trim = (text: string) =>
    text.length > ASSISTANT.parseContextCharacters ? `${text.slice(0, ASSISTANT.parseContextCharacters)}...` : text;
  return [
    'Earlier exchange, for context only:',
    `user: ${trim(context.user)}`,
    `assistant: ${trim(context.assistant)}`,
    '',
    `The LATEST message, the one to classify: ${question}`,
  ].join('\n');
}
