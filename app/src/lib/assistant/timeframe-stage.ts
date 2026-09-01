/**
 * Resolves every time period a question means, before the tool round runs
 * (refs #444; the copy-based pipeline this replaced was refs #265/#270).
 *
 * One constrained call takes the WHOLE question (plus the previous exchange
 * for follow-ups) and expresses each period as a structured window in the
 * interpreter's own branch shapes, meaning-first. Nothing is copied, so the
 * copy-truncation class ("same day, last week" -> "last week") cannot occur;
 * a comparison emits one window per period. Code resolves each window and
 * seeds the interpreter cache under its meaning label, so the later tool
 * call resolves with no model at all. The deterministic scan survives as
 * the fallback and recall floor, not a splicer.
 */
import { interpretWhen, parseFields, seedInterpreterCache, buildQuestionWindowsPrompt, buildQuestionWindowsSchema, questionOffersRolling, PART_OF_DAY_WORDS, WEEKDAY_WORDS, WEEKDAY_ABBREVS, MONTH_SEASON_NAMES, AMBIGUOUS_MONTH_WORDS } from './window-interpreter';
import { buildContextualQuestion, type ParseContext } from './parse-context';
import { normalizeWhenPhrase } from './tool-helpers';
import { log, LogLevel } from '../logger';
import { WINDOW_UNITS, resolveWindow, type WindowFields } from './event-range';
import type { AssistantProvider, ResolvedTimeframe } from './types';
import { isAbortError } from '../is-abort-error';

/** The one system line handed to the answering model, naming the exact phrases
 *  it may copy into `when`. Model-facing (rule 5 exempt). */
export function buildTimeframeSystemLine(phrases: string[]): string {
  const quoted = phrases.map((phrase) => `"${phrase}"`).join(', ');
  return `Timeframes for this question, already resolved (copy these exact phrases into when): ${quoted}.`;
}

/** A clock token: "4pm", "9 am", "16:30", "9:00pm". Requires a meridian or a
 *  colon, so a bare number ("9") is not one on its own (the compact-dash class
 *  handles bare numbers around a dash). */
const CLOCK_TOKEN = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}`;
/** Unit words a rolling span counts in, reusing the interpreter's own unit list
 *  plus "year" (which the interpreter cannot resolve but the scan still surfaces). */
const ROLLING_UNITS = `${WINDOW_UNITS.join('|')}|year`;
/** How a count can be written in front of a unit: digits, the small numbers
 *  spelled out, or the article forms of one ("an hour ago"). Shared by the
 *  rolling-span and "<n> <unit> ago" classes so both accept both spellings. */
const COUNT_TOKEN = String.raw`\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve`;

/** Deterministic, question-order, deduped scan for EVERY time expression whose
 *  class code can decide, returning each as a VERBATIM substring of the question.
 *  Verbatim is a contract: the provenance filter (whenNotFromQuestion) and the
 *  answering model's copy-into-`when` rule both require the phrase to be an exact
 *  substring of the question it came from.
 *
 *  The classes, each matched by one pattern below:
 *  1. Clock ranges: written spans "from 4pm to 10pm"/"between 9am and 5pm" (both
 *     ends clock tokens) and compact "10am-6pm"/"9-5"/"16:00-18:00".
 *  2. Month-name + day number: "july 15", "june 1".
 *  3. Rolling spans: "(past|last|previous) <n> <unit>" -> "past 2 weeks".
 *  4. Compound relative periods: "last month", "this month", "this year",
 *     "last week", "this week", "last weekend", "this weekend".
 *  5. Day words + part-of-day: "today"/"yesterday"/"tonight", a modifier +
 *     part-of-day ("this morning", "yesterday afternoon"), and bare part-of-day.
 *  6. Weekday references incl. "last <weekday>", across the shared WEEKDAY_WORDS.
 *  7. Bare month/season names: "april".
 *  8. Bare ordinals: "the 21st", "21st".
 *
 *  Longer matches win over the shorter ones they contain ("july" inside
 *  "july 15", "yesterday" inside "yesterday afternoon"), so each span is listed
 *  once, at its most specific.
 *
 *  The month/season names that double as everyday words ("may", "march",
 *  "fall", "spring") match only behind a determiner (in/the/this/last/...):
 *  "How may folks came" scanned as the month of May and the obedient planner
 *  issued a wasted whole-of-May query (refs #434). "<month> <day>" keeps the
 *  full list, since "may 15" is unambiguous. */
export function scanTimeExpressions(question: string): string[] {
  const months = [...MONTH_SEASON_NAMES].join('|');
  const plainMonths = [...MONTH_SEASON_NAMES].filter((m) => !AMBIGUOUS_MONTH_WORDS.includes(m)).join('|');
  const guardedMonths = AMBIGUOUS_MONTH_WORDS.join('|');
  const weekdays = [...WEEKDAY_WORDS, ...WEEKDAY_ABBREVS].join('|');
  const patterns: RegExp[] = [
    new RegExp(String.raw`\bfrom\s+(?:${CLOCK_TOKEN})\s+(?:to|until|through|till)\s+(?:${CLOCK_TOKEN})`, 'gi'),
    new RegExp(String.raw`\bbetween\s+(?:${CLOCK_TOKEN})\s+and\s+(?:${CLOCK_TOKEN})`, 'gi'),
    new RegExp(String.raw`\b\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?\s*[-–]\s*\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?\b`, 'gi'),
    new RegExp(String.raw`\b(?:${months})\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'gi'),
    // "between mon and tue", "from friday to sunday": a weekday span, with
    // the English abbreviations accepted only inside this anchored shape so
    // "sat" alone never scans as a day (refs #434).
    new RegExp(String.raw`\b(?:between|from)\s+(?:${weekdays})\s+(?:and|to|until|through|till)\s+(?:${weekdays})\b`, 'gi'),
    new RegExp(String.raw`\b(?:past|last|previous)\s+(?:${COUNT_TOKEN})\s+(?:${ROLLING_UNITS})s?\b`, 'gi'),
    // "2 days ago", "two days ago", "an hour ago". Without this the whole
    // family scanned empty and the turn fell through to the today default,
    // so the prompt told the model to answer about the wrong day (refs #310).
    new RegExp(String.raw`\b(?:${COUNT_TOKEN})\s+(?:${ROLLING_UNITS})s?\s+ago\b`, 'gi'),
    new RegExp(String.raw`\b(?:last|this|next)\s+(?:month|week|weekend|year)\b`, 'gi'),
    new RegExp(String.raw`\b(?:(?:this|last|yesterday)\s+)?(?:${PART_OF_DAY_WORDS.join('|')})\b`, 'gi'),
    new RegExp(String.raw`\b(?:today|tonight|yesterday)\b`, 'gi'),
    new RegExp(String.raw`\b(?:(?:last|this|next|on)\s+)?(?:${WEEKDAY_WORDS.join('|')})\b`, 'gi'),
    new RegExp(String.raw`\b(?:${plainMonths})\b|\b(?:in|the|a|an|this|last|of|during|for)\s+(?:${guardedMonths})\b`, 'gi'),
    new RegExp(String.raw`\b(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b`, 'gi'),
  ];

  const found: Array<{ start: number; end: number; text: string }> = [];
  for (const re of patterns) {
    for (const m of question.matchAll(re)) {
      if (m.index === undefined) continue;
      const text = m[0];
      if (text.trim().length === 0) continue;
      found.push({ start: m.index, end: m.index + text.length, text });
    }
  }

  // Longest-first at each start so a container is kept before what it holds;
  // then drop any span fully inside an already-kept one.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Array<{ start: number; end: number; text: string }> = [];
  for (const m of found) {
    if (kept.some((k) => k.start <= m.start && m.end <= k.end)) continue;
    kept.push(m);
  }

  // Appearance order, deduped on the normalized form ("today"/"Today" collapse
  // to the first occurrence).
  kept.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of kept) {
    const key = normalizeWhenPhrase(m.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m.text);
  }
  return out;
}

export interface ExtractedTimeframes {
  /** The resolved phrases to copy into `when`; the "today" default when the
   *  question named no time. Empty only when `abstained` is true. */
  phrases: string[];
  /** The same phrases paired with the structured window each resolved to, so
   *  a tool can decide in code whether the turn's period is calendar-based or a
   *  rolling window (refs #270). Mirrors `phrases`, except empty on the
   *  extraction-failure fast path and when even the default period could not be
   *  resolved (both of which still answer, so the guard using this stays off). */
  resolved: ResolvedTimeframe[];
  /** The question named a time no interpretation could resolve: the caller
   *  must tell the user and stop, not run the tool round on a wrong window. */
  abstained: boolean;
}

/**
 * The primary time path on EVERY backend (refs #444): the whole-question
 * windows interrogation, probed 13/13 on the live-failure matrix. Falls back
 * to the scan floor on any failure; abstains only when the model saw a
 * period nothing could resolve and the scan sees no time words either.
 */
export async function resolveTimeframesFromQuestion(
  question: string,
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
  context?: ParseContext,
): Promise<ExtractedTimeframes> {
  let windows: unknown[] = [];
  try {
    const reply = await provider.complete(
      buildQuestionWindowsPrompt(now, timezone),
      buildContextualQuestion(question, context),
      signal,
      buildQuestionWindowsSchema(questionOffersRolling(question)),
    );
    const raw = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? '{}') as { windows?: unknown[] };
    windows = Array.isArray(raw.windows) ? raw.windows : [];
  } catch (error) {
    if (isAbortError(error)) throw error;
    log.assistant('Question-window interrogation failed; falling back to the scan', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    return scanFallbackTimeframes(question, provider, now, timezone, signal);
  }

  const resolved: ResolvedTimeframe[] = [];
  const seen = new Set<string>();
  for (const [index, item] of windows.entries()) {
    if (item === null || typeof item !== 'object') continue;
    // Production parse, never a raw field read (refs #442): parseFields is
    // the one place every schema field round-trips.
    const fields = parseFields(JSON.stringify(item));
    if (!fields) continue;
    const window = resolveWindow(fields, now, timezone);
    if (window === undefined || 'error' in window) continue;
    const meaning = typeof (item as { meaning?: unknown }).meaning === 'string' ? (item as { meaning: string }).meaning.trim() : '';
    const phrase = meaning.length > 0 ? meaning : `window ${index + 1}`;
    const key = normalizeWhenPhrase(phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ phrase, fields });
    seedInterpreterCache(phrase, fields, now, timezone);
  }

  if (resolved.length > 0) {
    return { phrases: resolved.map((tf) => tf.phrase), resolved, abstained: false };
  }
  if (windows.length > 0 && scanTimeExpressions(question).length === 0) {
    return { phrases: [], resolved: [], abstained: true };
  }
  return scanFallbackTimeframes(question, provider, now, timezone, signal);
}

/** The deterministic floor: the scan's phrases through the per-phrase
 *  interpreter, the today default when it finds nothing. Never abstains -
 *  every phrase here is scan-vouched, and an unresolved one retries at tool
 *  time exactly as before. */
async function scanFallbackTimeframes(
  question: string,
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
): Promise<ExtractedTimeframes> {
  const scanPhrases = scanTimeExpressions(question);
  const phrases = scanPhrases.length > 0 ? scanPhrases : ['today'];
  const resolved: ResolvedTimeframe[] = [];
  for (const phrase of phrases) {
    const fields = await interpretWhen(phrase, provider, now, timezone, signal);
    if ('error' in fields && fields.error) continue;
    resolved.push({ phrase, fields: fields as WindowFields });
  }
  return { phrases, resolved, abstained: false };
}
