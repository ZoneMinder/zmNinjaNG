/**
 * The previous-turn context that rides the parse, coverage, and time calls
 * (refs #440, #446). STRUCTURED facts, never answer prose: the model stole
 * "truck", "Front Yard", and "today" out of answer text across three live
 * transcripts. What a follow-up can inherit is the previous QUESTION, the
 * slots that turn resolved, and the assistant's closing offer - and only
 * when the closing sentence actually asked something.
 */
import { ASSISTANT } from '../zmninja-ng-constants';

export interface PrevTurn {
  /** The previous user question, verbatim (trimmed hard). */
  question: string;
  /** The assistant's closing sentence, only when it ended with a question
   *  mark: "yes" answers an offer, and nothing else in the answer is safe
   *  to show. */
  offer?: string;
  /** Monitor names the previous turn resolved to ([] = it was unpinned). */
  monitors?: string[];
  /** The previous turn's window meaning labels. */
  periods?: string[];
}

/** Backwards-typed alias kept for call sites; the shape is PrevTurn now. */
export type ParseContext = PrevTurn;

const trim = (text: string): string =>
  text.length > ASSISTANT.parseContextCharacters ? `${text.slice(0, ASSISTANT.parseContextCharacters)}...` : text;

/** The previous turn derived from the thread alone (question + offer); the
 *  caller merges in the structured slots it stored from the previous run. */
export function prevTurnFromThread(history: ReadonlyArray<{ role: string; text?: string }>): PrevTurn | undefined {
  for (let i = history.length - 1; i >= 1; i--) {
    const assistant = history[i];
    if (assistant.role !== 'assistant' || !assistant.text) continue;
    for (let j = i - 1; j >= 0; j--) {
      const user = history[j];
      if (user.role !== 'user' || !user.text) continue;
      const sentences = assistant.text.trim().split(/(?<=[.!?])\s+/);
      const last = sentences[sentences.length - 1] ?? '';
      return {
        question: user.text,
        ...(last.endsWith('?') ? { offer: last } : {}),
      };
    }
    return undefined;
  }
  return undefined;
}

/** The question as the model calls receive it: bare, or preceded by the
 *  previous turn's structured facts so a short follow-up carries its topic
 *  with nothing prose-mined. */
export function buildContextualQuestion(question: string, prev?: PrevTurn): string {
  if (!prev) return question;
  const lines = [`Earlier question, for context only: "${trim(prev.question)}"`];
  if (prev.monitors !== undefined) {
    lines.push(
      prev.monitors.length > 0
        ? `It was about these cameras: ${prev.monitors.join(', ')}.`
        : 'It was not about a particular camera.',
    );
  }
  if (prev.periods?.length) lines.push(`Its period: ${prev.periods.map(trim).join('; ')}.`);
  if (prev.offer) lines.push(`The assistant then asked: "${trim(prev.offer)}"`);
  lines.push('', `The LATEST message: ${question}`);
  return lines.join('\n');
}
