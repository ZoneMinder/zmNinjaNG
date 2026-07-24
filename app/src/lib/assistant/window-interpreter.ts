/**
 * Interprets a human time phrase into structured window fields, using a MODEL
 * under a constrained schema (refs #265).
 *
 * Division of labor, each part doing what it measurably does best:
 * - The assistant model COPIES the user's time words into `when` verbatim
 *   (measured perfect on both reference models; the same models filled a
 *   structured time DSL directly at 27/36 and 15/36 after two prompt
 *   iterations, reading "today" as a rolling day and "last week" as 7 weeks).
 * - THIS single-purpose call interprets the phrase into `WindowFields`, in
 *   any language, constrained to the schema where the backend supports it.
 * - `resolveWindow` (event-range.ts) does the arithmetic in code.
 *
 * No app-side phrase grammar exists anywhere in this path: the examples in
 * the interpreter prompt teach the mapping, they are not a parser.
 */
import type { AssistantProvider } from './types';
import { WINDOW_UNITS, WEEKDAYS, type WindowFields } from './event-range';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { log, LogLevel } from '../logger';

/** The interpreter's output contract, enforced via constrained generation on
 *  backends that support it (Ollama json_schema, WebLLM XGrammar) and parsed
 *  defensively everywhere. `none: true` means the phrase names no time window
 *  at all ("everything you have"). */
export const WINDOW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    lastCount: { type: 'number' },
    lastUnit: { type: 'string', enum: [...WINDOW_UNITS] },
    daysAgo: { type: 'number' },
    weekday: { type: 'string', enum: [...WEEKDAYS] },
    dayOfMonth: { type: 'number' },
    weekend: { type: 'number' },
    date: { type: 'string' },
    fromDate: { type: 'string' },
    toDate: { type: 'string' },
    fromTime: { type: 'string' },
    toTime: { type: 'string' },
    none: { type: 'boolean' },
  },
  additionalProperties: false,
};

/** Model-facing (rule 5 exempt). The few-shot lines teach the mapping the
 *  schema cannot express; they are examples for a model, not a grammar the
 *  app executes. Exported so the eval harness scores EXACTLY what production
 *  sends: a hand-copied prompt in the harness drifted the moment this one
 *  changed, and measured a bug the app did not have. */
export function buildInterpreterPrompt(now: Date, timezone: string): string {
  const today = format(toZonedTime(now, timezone), 'EEEE, yyyy-MM-dd');
  return [
    'You convert a human time phrase into a JSON time window. Reply with ONLY one JSON object.',
    `Today is ${today} (timezone ${timezone}).`,
    'Fields (use the fewest that express the phrase):',
    '- lastCount + lastUnit: a rolling span ending now. "past 2 weeks" -> {"lastCount":2,"lastUnit":"week"}; "last 6 hours" -> {"lastCount":6,"lastUnit":"hour"}.',
    '- daysAgo: one calendar day. "today" -> {"daysAgo":0}. "yesterday" -> {"daysAgo":1}. "the day before yesterday" -> {"daysAgo":2}.',
    '- weekday: the most recent such day. "on sunday" -> {"weekday":"sunday"}; "last tuesday" -> {"weekday":"tuesday"}.',
    '- dayOfMonth: a bare ordinal, just the number. "the 21st" -> {"dayOfMonth":21}; "on the 3rd" -> {"dayOfMonth":3}. Code picks the most recent past such day, so do NOT work out the date yourself.',
    '- weekend: whole weekends ago as a number, ONLY when the phrase literally says "weekend". "this weekend" -> {"weekend":0}; "last weekend" -> {"weekend":1}. Code works out the two dates.',
    '- date: one explicit calendar date. "July 15" -> {"date":"2026-07-15"} (use the year that makes it most recent, never future).',
    '- fromDate + toDate: a calendar span, both inclusive. "april" -> {"fromDate":"2026-04-01","toDate":"2026-04-30"}. "this month" -> the 1st of the current month through today. "this year" -> {"fromDate":"2026-01-01","toDate":"2026-12-31"}. "june 1 to 15" -> both dates. Either side may stand alone: "since july 1" -> {"fromDate":"2026-07-01"}.',
    '- fromTime/toTime: 24h "HH:MM" from 00:00 to 23:59, narrowing ONE day named by daysAgo/weekday/date. "yesterday from 4pm to 10pm" -> {"daysAgo":1,"fromTime":"16:00","toTime":"22:00"}.',
    '- A part of the day is a day plus a clock band: morning 06:00-12:00, noon 11:00-13:00, afternoon 12:00-18:00, evening 18:00-23:59, night 20:00-23:59. ALWAYS include the day, defaulting to today (daysAgo 0) when none is named: "this morning" -> {"daysAgo":0,"fromTime":"06:00","toTime":"12:00"}; "around noon" -> {"daysAgo":0,"fromTime":"11:00","toTime":"13:00"}; "last night" -> {"daysAgo":1,"fromTime":"20:00","toTime":"23:59"}; "last tuesday night" -> {"weekday":"tuesday","fromTime":"20:00","toTime":"23:59"}.',
    '- none: true when the phrase asks for no time limit. "all time" -> {"none":true}.',
    'Keep BOTH halves of a compound phrase, in any language: a day word and a part of the day both survive. "yesterday evening" -> {"daysAgo":1,"fromTime":"18:00","toTime":"23:59"}; "hier apres-midi" -> {"daysAgo":1,"fromTime":"12:00","toTime":"18:00"}.',
    'The phrase may be in any language: "letzte Woche" -> {"lastCount":1,"lastUnit":"week"}; "ayer" -> {"daysAgo":1}; "ce matin" -> {"daysAgo":0,"fromTime":"06:00","toTime":"12:00"}; "el fin de semana pasado" -> {"weekend":1}.',
    'A calendar day word is never a rolling span: "today" is daysAgo 0, NOT lastCount 1 day. A part of the day is never a rolling span either.',
  ].join('\n');
}

/** Session cache: the same phrase on the same calendar day means the same
 *  window, and "yesterday"/"today" repeat constantly. */
const CACHE = new Map<string, WindowFields | { error: string }>();

/** Test-only. */
export function resetWindowInterpreterCacheForTests(): void {
  CACHE.clear();
}

/** The parsed fields for `phrase`, or `{error}` written for the model that
 *  sent the phrase. Never throws. */
export async function interpretWhen(
  phrase: string,
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
): Promise<WindowFields | { error: string }> {
  const cacheKey = `${format(toZonedTime(now, timezone), 'yyyy-MM-dd')}::${timezone}::${phrase.trim().toLowerCase()}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  let result: WindowFields | { error: string };
  try {
    const reply = await provider.complete(buildInterpreterPrompt(now, timezone), phrase, signal, WINDOW_SCHEMA);
    const parsed = parseFields(reply.text);
    result = parsed ?? { error: `Could not interpret "${phrase}" as a time window. Rephrase the when argument.` };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    log.assistant('Window interpretation failed', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    result = { error: `Could not interpret "${phrase}" as a time window right now. Retry, or rephrase the when argument.` };
  }
  CACHE.set(cacheKey, result);
  return result;
}

/** The first JSON object in `text` as WindowFields, or undefined. Defensive:
 *  an unconstrained backend may wrap the object in prose. */
function parseFields(text: string): WindowFields | undefined {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return undefined;
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    if (raw.none === true) return {};
    const fields: WindowFields = {};
    if (raw.lastCount !== undefined) fields.lastCount = Number(raw.lastCount);
    if (raw.lastUnit !== undefined) fields.lastUnit = String(raw.lastUnit);
    if (raw.daysAgo !== undefined) fields.daysAgo = Number(raw.daysAgo);
    if (raw.weekday !== undefined) fields.weekday = String(raw.weekday);
    if (raw.dayOfMonth !== undefined) fields.dayOfMonth = Number(raw.dayOfMonth);
    if (raw.weekend !== undefined) fields.weekend = Number(raw.weekend);
    if (raw.date !== undefined) fields.date = String(raw.date);
    if (raw.fromDate !== undefined) fields.fromDate = String(raw.fromDate);
    if (raw.toDate !== undefined) fields.toDate = String(raw.toDate);
    if (raw.fromTime !== undefined) fields.fromTime = String(raw.fromTime);
    if (raw.toTime !== undefined) fields.toTime = String(raw.toTime);
    return fields;
  } catch {
    return undefined;
  }
}
