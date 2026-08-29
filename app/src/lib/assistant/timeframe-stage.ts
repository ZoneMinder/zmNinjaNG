/**
 * Extracts and resolves EVERY timeframe a ZoneMinder question names, before
 * the tool round runs (refs #270).
 *
 * The tool loop asks the model to copy the user's time words into `when` and
 * then interprets each phrase on demand (window-interpreter.ts). On a backend
 * whose runtime owns the tool loop (apple, native) that interpretation would
 * have to nest a second model call INSIDE a tool call, which the native loops
 * cannot do. So this stage front-runs it: one constrained call lists every
 * time expression in the question, each is resolved through the SAME
 * `interpretWhen` (pre-warming its per-day cache, so the later tool call hits
 * the cache and never nests a model call), and the turn learns up front
 * whether the period is knowable at all.
 *
 * Division of labor mirrors the interpreter's (refs #265): the model finds the
 * time words in any language, code decides what to do with them.
 * - No timeframe stated -> "today" (the app's default period).
 * - A stated timeframe that no interpretation can resolve -> abstain: the
 *   caller tells the user it could not work out the period and stops, rather
 *   than answering the wrong window with real data.
 * - Several timeframes -> all of them, so "today vs yesterday" resolves both.
 */
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { interpretWhen, PART_OF_DAY_WORDS, WEEKDAY_WORDS, MONTH_SEASON_NAMES } from './window-interpreter';
import { normalizeWhenPhrase } from './tool-helpers';
import { log, LogLevel } from '../logger';
import { WINDOW_UNITS, type WindowFields } from './event-range';
import type { AssistantProvider, ResolvedTimeframe } from './types';
import { isAbortError } from '../is-abort-error';

/** The extractor's output contract, constrained on backends that support it
 *  (Ollama json_schema, WebLLM XGrammar) and parsed defensively everywhere.
 *  `none: true` means the question named no time at all. */
export const TIMEFRAME_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    phrases: { type: 'array', items: { type: 'string' } },
    none: { type: 'boolean' },
  },
  additionalProperties: false,
};

/** Model-facing (rule 5 exempt): never rendered, only sent to the model. The
 *  `today` line is computed in code so the model never has to know the date. */
export function buildTimeframePrompt(now: Date, timezone: string): string {
  const today = format(toZonedTime(now, timezone), 'EEEE, yyyy-MM-dd');
  return [
    'You find the time expressions in one question about security-camera events. Reply with ONLY one JSON object.',
    `Today is ${today} (timezone ${timezone}).`,
    'A time expression is ANY phrase naming when events happened: a day ("today", "yesterday"), a rolling span',
    '("the past 2 weeks", "last month"), a part of the day ("this morning", "this evening"), a month or season',
    '("april", "this summer"), a weekday, a date ("July 21"), or a clock range, whether written out',
    '("from 4pm to 10pm", "between 9am and 5pm") or compact ("10am-6pm", "9-5"). They are',
    'often embedded mid-sentence: "how busy was it in april" contains "april".',
    'List every one in "phrases", each copied VERBATIM in the user\'s own language ("today", "letzte Woche", "in april").',
    'Do not translate, normalize, invent, or add a time the question does not state.',
    'A question may hold several time expressions, or none.',
    'Set "none" true and "phrases" [] when the question names no time at all.',
  ].join('\n');
}

/** The one system line handed to the answering model, naming the exact phrases
 *  it may copy into `when`. Model-facing (rule 5 exempt). */
export function buildTimeframeSystemLine(phrases: string[]): string {
  const quoted = phrases.map((phrase) => `"${phrase}"`).join(', ');
  return `Timeframes for this question, already resolved (copy these exact phrases into when): ${quoted}.`;
}

/** The phrases array from the extractor's reply, or [] when unparseable.
 *  Defensive: an unconstrained backend may wrap the object in prose. */
function parsePhrases(text: string): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    if (!Array.isArray(raw.phrases)) return [];
    return raw.phrases.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
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
 *  ponytail: month/season names include the everyday words "may", "march",
 *  "fall", "spring", so a non-time use ("it may rain") over-matches to a month.
 *  Upgrade path if that bites: require a leading in/the/this/last for those four. */
export function scanTimeExpressions(question: string): string[] {
  const months = [...MONTH_SEASON_NAMES].join('|');
  const patterns: RegExp[] = [
    new RegExp(String.raw`\bfrom\s+(?:${CLOCK_TOKEN})\s+(?:to|until|through|till)\s+(?:${CLOCK_TOKEN})`, 'gi'),
    new RegExp(String.raw`\bbetween\s+(?:${CLOCK_TOKEN})\s+and\s+(?:${CLOCK_TOKEN})`, 'gi'),
    new RegExp(String.raw`\b\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?\s*[-–]\s*\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?\b`, 'gi'),
    new RegExp(String.raw`\b(?:${months})\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'gi'),
    new RegExp(String.raw`\b(?:past|last|previous)\s+(?:${COUNT_TOKEN})\s+(?:${ROLLING_UNITS})s?\b`, 'gi'),
    // "2 days ago", "two days ago", "an hour ago". Without this the whole
    // family scanned empty and the turn fell through to the today default,
    // so the prompt told the model to answer about the wrong day (refs #310).
    new RegExp(String.raw`\b(?:${COUNT_TOKEN})\s+(?:${ROLLING_UNITS})s?\s+ago\b`, 'gi'),
    new RegExp(String.raw`\b(?:last|this|next)\s+(?:month|week|weekend|year)\b`, 'gi'),
    new RegExp(String.raw`\b(?:(?:this|last|yesterday)\s+)?(?:${PART_OF_DAY_WORDS.join('|')})\b`, 'gi'),
    new RegExp(String.raw`\b(?:today|tonight|yesterday)\b`, 'gi'),
    new RegExp(String.raw`\b(?:(?:last|this|next|on)\s+)?(?:${WEEKDAY_WORDS.join('|')})\b`, 'gi'),
    new RegExp(String.raw`\b(?:${months})\b`, 'gi'),
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
 * Every timeframe the question resolves to, or an abstention.
 *
 * ONE constrained model call finds the time words; each is then resolved
 * through `interpretWhen`, which caches the result for this calendar day so
 * the later tool call reuses it. A phrase no interpretation can turn into a
 * window is dropped. Never throws except on abort (which propagates from the
 * model calls, matching the rest of the assistant path).
 */
export async function extractTimeframes(
  question: string,
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
): Promise<ExtractedTimeframes> {
  // Code-first extraction (refs #270): a deterministic scan OWNS every time class
  // it can recognize, so the shapes that flaked on-device (compact clock ranges
  // never surfacing, multi-value lists dropping members, even "last month"
  // vanishing once: measured 11-12/16 across FM runs) are decided in code, not
  // left to a nondeterministic decoder whose worst shape is exactly a free-string
  // array. The model call still runs and only ADDS phrasings code cannot see
  // (unlisted languages, odd wording), so extraction flakiness is bounded to
  // phrasings no scanner could detect.
  const scanPhrases = scanTimeExpressions(question);

  let extracted: string[] = [];
  try {
    const reply = await provider.complete(buildTimeframePrompt(now, timezone), question, signal, TIMEFRAME_SCHEMA);
    extracted = parsePhrases(reply.text);
  } catch (error) {
    if (isAbortError(error)) throw error;
    log.assistant('Timeframe extraction failed', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    // With the scan in hand the turn is not blind when the model call fails: only
    // fall straight to the default period when the scan also found nothing (the
    // pre-scan fail-open path). Otherwise proceed on the scan phrases alone.
    if (scanPhrases.length === 0) return { phrases: ['today'], resolved: [], abstained: false };
  }

  // The model parrots the prompt's own date line (buildTimeframePrompt names
  // today, the weekday, the ISO date and the timezone), so the extractor returns
  // time words the user never typed. Provenance is decidable in code, exactly as
  // whenNotFromQuestion decides it: a phrase that truly came from the question is
  // a substring of it. Filter the MODEL's phrases to those; scan phrases are
  // verbatim substrings by construction and never need this filter.
  const normalizedQuestion = normalizeWhenPhrase(question);
  const modelStated = extracted.filter((phrase) => {
    if (normalizedQuestion.includes(normalizeWhenPhrase(phrase))) return true;
    log.assistant('Dropped parroted timeframe phrase', LogLevel.DEBUG, { phrase });
    return false;
  });

  // Union scan + model, de-duped on the normalized form: the scan owns its
  // classes and wins ties (listed first, in question order), the model only adds
  // a phrase whose normalized form the scan did not already cover.
  const scanKeys = new Set(scanPhrases.map(normalizeWhenPhrase));
  const seen = new Set<string>();
  const union: string[] = [];
  for (const phrase of [...scanPhrases, ...modelStated]) {
    const key = normalizeWhenPhrase(phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    union.push(phrase);
  }
  const namedTime = union.length > 0;

  const resolved: ResolvedTimeframe[] = [];
  for (const phrase of namedTime ? union : ['today']) {
    const fields = await interpretWhen(phrase, provider, now, timezone, signal);
    if ('error' in fields && fields.error) continue;
    resolved.push({ phrase, fields: fields as WindowFields });
  }

  // Neither path named a time: the default period, kept even if it failed to
  // resolve so the turn still proceeds on today.
  if (!namedTime) return { phrases: ['today'], resolved, abstained: false };

  // A phrase survives into the allowed list if it resolved OR the scan detected
  // it. An unresolvable compact clock range ("10am-6pm", "9-5", "from 4pm to
  // 10pm") carries no day to anchor it, yet the token-level provenance layer lets
  // the answering model legally compose it with a day word from the same
  // question, so it must still be offered. An unresolved MODEL-only phrase
  // ("blursday") is a hallucinated period and is dropped.
  const resolvedKeys = new Set(resolved.map((tf) => normalizeWhenPhrase(tf.phrase)));
  const phrases = union.filter((phrase) => {
    const key = normalizeWhenPhrase(phrase);
    return resolvedKeys.has(key) || scanKeys.has(key);
  });

  // Everything stated failed to resolve and the scan vouched for nothing: the
  // question named a period no interpretation could work out, so abstain rather
  // than answer a wrong window with real data.
  if (phrases.length === 0) return { phrases: [], resolved: [], abstained: true };
  return { phrases, resolved, abstained: false };
}
