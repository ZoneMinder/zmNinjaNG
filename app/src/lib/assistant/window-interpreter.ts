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
import { isAbortError } from '../is-abort-error';

/** The interpreter's output contract, enforced via constrained generation on
 *  backends that support it (Ollama json_schema, WebLLM XGrammar, Apple FM
 *  DynamicGenerationSchema) and parsed defensively everywhere.
 *
 *  A top-level anyOf of small per-class branches, each with its identifying
 *  field(s) REQUIRED. One wide object of 10+ all-optional fields invites a
 *  constrained decoder to junk-fill optionals (measured on Apple FM: a spurious
 *  "weekend":0 on nearly every failure) and to drop paired fields (every rolling
 *  case kept lastCount but dropped lastUnit). Required-field branches make both
 *  impossible by construction: FM scored 30/50 under the wide shape and 0/5 on
 *  rolling with lastUnit dropped every time. The branch shape stays a FLAT
 *  object with the same key names, so `parseFields` and `resolveWindow` read the
 *  same keys regardless of which branch produced them. `none: true` means the
 *  phrase names no time window at all ("everything you have").
 *
 *  v2: nearly every branch is all-required, because FM dropped every optional
 *  field left inside a branch (fromTime/toTime on the day branches, toDate on
 *  the span branch) exactly as it once dropped lastUnit. So each "narrowed"
 *  shape becomes its own branch (a day, and a day+clock-band), the span splits
 *  into three all-required branches (both ends, since-only, until-only), and
 *  `weekend` is a string enum (FM is exact on enums: weekday scored 100%),
 *  mapped back to a weekends-ago number in `resolveWindow`.
 *
 *  The ONE exception is the weekday branch, which keeps fromTime/toTime optional:
 *  splitting it regressed qwen, which anchored on the weekday word and dropped
 *  the clock band on "last tuesday night" (measured 3/3). FM and qwen react to
 *  the split oppositely there; the qwen 150/150 gate keeps this branch single. */
export const WINDOW_SCHEMA: Record<string, unknown> = {
  anyOf: [
    // rolling span ending now: both halves are meaningless alone.
    { type: 'object', properties: { meaning: { type: 'string' }, lastCount: { type: 'number' }, lastUnit: { type: 'string', enum: [...WINDOW_UNITS] } }, required: ['meaning', 'lastCount', 'lastUnit'], additionalProperties: false },
    // one calendar day ("yesterday").
    { type: 'object', properties: { meaning: { type: 'string' }, daysAgo: { type: 'number' } }, required: ['meaning', 'daysAgo'], additionalProperties: false },
    // one calendar day narrowed to a clock band ("this morning").
    { type: 'object', properties: { meaning: { type: 'string' }, daysAgo: { type: 'number' }, fromTime: { type: 'string' }, toTime: { type: 'string' } }, required: ['meaning', 'daysAgo', 'fromTime', 'toTime'], additionalProperties: false },
    // most recent such weekday, optionally narrowed to a clock band
    // ("on sunday", "last tuesday night"). The lone branch that KEEPS fromTime/
    // toTime optional: splitting it into a bare and a with-times branch (as the
    // day branch is split) measured qwen dropping the clock band on "last
    // tuesday night" 3/3, anchoring on the weekday and taking the bare branch.
    // Unlike the day branches, the weekday word dominates the phrase, so the
    // model reads the split as license to stop early. FM wants required fields;
    // qwen needs this one optional; the 150/150 gate decides it.
    { type: 'object', properties: { meaning: { type: 'string' }, weekday: { type: 'string', enum: [...WEEKDAYS] }, fromTime: { type: 'string' }, toTime: { type: 'string' } }, required: ['meaning', 'weekday'], additionalProperties: false },
    // a calendar week, Monday-anchored; code works out the dates (refs #438).
    { type: 'object', properties: { meaning: { type: 'string' }, week: { type: 'string', enum: ['this', 'last'] } }, required: ['meaning', 'week'], additionalProperties: false },
    // a span between two weekdays ("between mon and tue"); code works out the
    // dates, so the model never anchors the wrong calendar day (refs #434).
    { type: 'object', properties: { meaning: { type: 'string' }, fromWeekday: { type: 'string', enum: [...WEEKDAYS] }, toWeekday: { type: 'string', enum: [...WEEKDAYS] } }, required: ['meaning', 'fromWeekday', 'toWeekday'], additionalProperties: false },
    // a bare ordinal day-of-month ("the 21st").
    { type: 'object', properties: { meaning: { type: 'string' }, dayOfMonth: { type: 'number' } }, required: ['meaning', 'dayOfMonth'], additionalProperties: false },
    // that ordinal narrowed to a clock band.
    { type: 'object', properties: { meaning: { type: 'string' }, dayOfMonth: { type: 'number' }, fromTime: { type: 'string' }, toTime: { type: 'string' } }, required: ['meaning', 'dayOfMonth', 'fromTime', 'toTime'], additionalProperties: false },
    // one explicit calendar date ("July 15").
    { type: 'object', properties: { meaning: { type: 'string' }, date: { type: 'string' } }, required: ['meaning', 'date'], additionalProperties: false },
    // that date narrowed to a clock band ("July 15 morning").
    { type: 'object', properties: { meaning: { type: 'string' }, date: { type: 'string' }, fromTime: { type: 'string' }, toTime: { type: 'string' } }, required: ['meaning', 'date', 'fromTime', 'toTime'], additionalProperties: false },
    // whole weekends ago; code computes the two dates.
    { type: 'object', properties: { meaning: { type: 'string' }, weekend: { type: 'string', enum: ['this', 'last', 'two-ago'] } }, required: ['meaning', 'weekend'], additionalProperties: false },
    // calendar span, both ends inclusive ("april", "june 1 to 15").
    { type: 'object', properties: { meaning: { type: 'string' }, fromDate: { type: 'string' }, toDate: { type: 'string' } }, required: ['meaning', 'fromDate', 'toDate'], additionalProperties: false },
    // calendar span open at the end ("since july 1").
    { type: 'object', properties: { meaning: { type: 'string' }, fromDate: { type: 'string' } }, required: ['meaning', 'fromDate'], additionalProperties: false },
    // calendar span open at the start ("until july 15").
    { type: 'object', properties: { meaning: { type: 'string' }, toDate: { type: 'string' } }, required: ['meaning', 'toDate'], additionalProperties: false },
    // no time limit at all.
    { type: 'object', properties: { meaning: { type: 'string' }, none: { type: 'boolean' } }, required: ['meaning', 'none'], additionalProperties: false },
  ],
};

/** Part-of-day words across en/fr/es/de, already accent-stripped and lowercase
 *  (the form `normalizePhrase` produces before matching). Matched as whole words
 *  so "soir" does not fire inside "soiree" nor "manana" inside "semana".
 *  Exported so the deterministic scanner (timeframe-stage.ts) recognizes the
 *  same part-of-day vocabulary this interpreter does, rather than duplicating it. */
export const PART_OF_DAY_WORDS = [
  'morning', 'afternoon', 'evening', 'night', 'noon', 'midnight',
  'lunch', 'lunchtime',
  'matin', 'soir', 'apres-midi', 'nuit', 'midi',
  'manana', 'tarde', 'noche', 'mediodia',
  'morgen', 'abend', 'nacht', 'mittag',
];
const PART_OF_DAY_RE = new RegExp(`\\b(${PART_OF_DAY_WORDS.join('|')})\\b`);
/** Weekday NAMES across en/de/es/fr, accent-stripped and lowercase (the form
 *  `normalizePhrase` produces), matched as whole words. The weekday branch is the
 *  ONE clock branch whose band stays optional (the measured qwen-compat
 *  exception), so it is the simplest fit among the clock branches and a
 *  constrained decoder is drawn to it, decoding a non-weekday phrase ("yesterday
 *  evening", "today between 9am and 5pm") as a weekday. A phrase without a weekday
 *  word cannot mean one, so the branch is offered only when one is present.
 *  Exported so the deterministic scanner (timeframe-stage.ts) recognizes the same
 *  weekday vocabulary rather than keeping a second list. */
export const WEEKDAY_WORDS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonnabend', 'sonntag',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
];
const WEEKDAY_RE = new RegExp(`\\b(${WEEKDAY_WORDS.join('|')})\\b`);
/** English weekday abbreviations, accepted ONLY where a surrounding shape
 *  anchors them (the weekday-range scan class and branch pick, refs #434):
 *  bare, "sat" is a verb and "mon" is French for "my". */
export const WEEKDAY_ABBREVS = [
  'mon', 'tue', 'tues', 'wed', 'weds', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
];
const WEEKDAYISH_RE = new RegExp(`\\b(${[...WEEKDAY_WORDS, ...WEEKDAY_ABBREVS].join('|')})\\b`, 'g');
/** The month/season names that double as everyday English words; the scan
 *  (timeframe-stage.ts) requires a determiner in front of these (refs #434). */
export const AMBIGUOUS_MONTH_WORDS = ['may', 'march', 'fall', 'spring'];
/** A wall-clock marker in the phrase: "4pm"/"9 am", "16:30", or a bare numeric
 *  range "4-6". Any of these means the phrase names a clock band. */
const CLOCK_RE = /\d\s*(am|pm)\b|\d{1,2}:\d{2}|\d+\s*-\s*\d+/;
/** A rolling span written with an explicit count: "past 2", "last 6". Only
 *  consulted alongside a clock marker, to decide whether to keep the rolling
 *  family too (e.g. "last 2 nights"). */
const ROLLING_RE = /\b(past|last|previous)\s+\d+/;
/** Month and season NAMES (English; an unlisted language falls open, see
 *  `selectBranches`). A bare one of these, no digits, means a whole-month span.
 *  Exported so the deterministic scanner (timeframe-stage.ts) recognizes the same
 *  month/season vocabulary rather than duplicating it. */
export const MONTH_SEASON_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'spring', 'summer', 'autumn', 'fall', 'winter',
]);
/** Leading words allowed before a bare month/season without disqualifying it as
 *  bare ("the april", "in april", "el/la/le/les ..."). */
const SPAN_ARTICLES = new Set([
  'the', 'a', 'an', 'this', 'last', 'in', 'of', 'during',
  'el', 'la', 'le', 'les', 'der', 'die', 'das',
]);

/** Accent-insensitive lowercase, so "apres-midi" matches "après-midi" and
 *  "manana" matches "mañana". */
function normalizePhrase(phrase: string): string {
  return phrase.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The WINDOW_SCHEMA branches subset to those a phrase's DECIDABLE markers need,
 *  so a constrained decoder cannot pick the simplest matching branch and drop a
 *  band the phrase carries (the decoder always takes the simplest branch that
 *  fits: measured part-of-day 0-1/4 and clock-range 0/2 across four on-device FM
 *  runs while every bare-day class was perfect, because FM read a clock phrase
 *  onto a bare-day branch). Markers are decided here in code, so a phrase we can
 *  detect cannot lose its band by branch choice, and one we cannot detect keeps
 *  the FULL schema unchanged (fail-open, byte-identical to before).
 *
 *  - CLOCK marker (a wall-clock token or a part-of-day word) -> ONLY the branches
 *    that can carry fromTime/toTime (day+clock, dayOfMonth+clock, date+clock). The
 *    weekday branch joins them ONLY when the phrase carries a weekday word: its
 *    band is optional, making it the simplest fit a decoder gravitates to, so a
 *    phrase with no weekday word must not be able to decode to it. A rolling
 *    marker present too keeps the rolling family as well ("last 2 nights").
 *  - BARE month/season name, no digits -> ONLY the both-ends span branch, so
 *    "april" cannot decode to an open or single-date branch.
 *  - No marker -> the full schema, exactly as today.
 *
 *  Wordlist ceiling: an unlisted language matches no marker and falls open to
 *  today's behavior, never worse. */
export function selectBranches(phrase: string): Record<string, unknown> {
  const branches = WINDOW_SCHEMA.anyOf as Array<{ properties: Record<string, unknown>; required: string[] }>;
  const norm = normalizePhrase(phrase);

  const hasClock = CLOCK_RE.test(norm) || PART_OF_DAY_RE.test(norm);
  if (hasClock) {
    const hasRolling = ROLLING_RE.test(norm);
    const hasWeekday = WEEKDAY_RE.test(norm);
    const picked = branches.filter((b) => {
      // The weekday branch keeps its clock band optional, so a decoder takes it as
      // the simplest fit and mislabels non-weekday phrases as weekdays. Offer it
      // only when the phrase actually names a weekday.
      if (b.properties.weekday !== undefined) return hasWeekday;
      return b.properties.fromTime !== undefined || (hasRolling && b.properties.lastCount !== undefined);
    });
    return wrap(picked);
  }

  // Two weekday words (abbreviations included: the range shape anchors them)
  // mean a weekday span; offered alone so the decoder cannot anchor on the
  // simpler single-weekday branch and drop one end (refs #434).
  const weekdayish = norm.match(WEEKDAYISH_RE) ?? [];
  if (weekdayish.length >= 2) {
    return wrap(branches.filter((b) => b.required.includes('fromWeekday')));
  }

  if (!/\d/.test(norm)) {
    const tokens = norm.split(/[^a-z]+/).filter(Boolean);
    const names = tokens.filter((t) => MONTH_SEASON_NAMES.has(t));
    const others = tokens.filter((t) => !MONTH_SEASON_NAMES.has(t) && !SPAN_ARTICLES.has(t));
    if (names.length === 1 && others.length === 0) {
      return wrap(branches.filter((b) => b.required.includes('fromDate') && b.required.includes('toDate')));
    }
  }

  return WINDOW_SCHEMA;
}

/** A picked branch list as a schema: fall open to the full schema if nothing
 *  matched (defensive), a bare object for one branch (the Apple FM converter
 *  wants no single-element anyOf, mirroring buildTurnSchema), else an anyOf. */
function wrap(picked: Array<Record<string, unknown>>): Record<string, unknown> {
  if (picked.length === 0) return WINDOW_SCHEMA;
  if (picked.length === 1) return picked[0];
  return { anyOf: picked };
}

/** Model-facing (rule 5 exempt). The few-shot lines teach the mapping the
 *  schema cannot express; they are examples for a model, not a grammar the
 *  app executes. Exported so the eval harness scores EXACTLY what production
 *  sends: a hand-copied prompt in the harness drifted the moment this one
 *  changed, and measured a bug the app did not have. */
/** The field-teaching lines both time prompts share: the per-phrase
 *  interpreter and the whole-question windows interrogation (refs #444)
 *  must teach identical vocabulary or their answers drift apart. */
function fieldTeachingLines(now: Date, timezone: string): string[] {
  const today = format(toZonedTime(now, timezone), 'EEEE, yyyy-MM-dd');
  return [
    `Today is ${today} (timezone ${timezone}).`,
    'Fields (use the fewest that express the phrase):',
    '- lastCount + lastUnit: a rolling span ending now. "past 2 weeks" -> {"lastCount":2,"lastUnit":"week"}; "last 6 hours" -> {"lastCount":6,"lastUnit":"hour"}.',
    '- daysAgo: one calendar day. "today" -> {"daysAgo":0}. "yesterday" -> {"daysAgo":1}. "the day before yesterday" -> {"daysAgo":2}.',
    '- weekday: the most recent such day. "on sunday" -> {"weekday":"sunday"}; "last tuesday" -> {"weekday":"tuesday"}.',
    '- fromWeekday + toWeekday: a span between two weekdays, full names. "between mon and tue" -> {"fromWeekday":"monday","toWeekday":"tuesday"}; "from friday to sunday" -> {"fromWeekday":"friday","toWeekday":"sunday"}. Code works out the dates, so do NOT send fromDate/toDate for these.',
    '- "week": a calendar week, Monday-anchored. "this week" or "all this week" -> {"week":"this"}; "last week" -> {"week":"last"}. Code works out the dates; never send fromDate/toDate for these.',
    '- dayOfMonth: a bare ordinal, just the number. "the 21st" -> {"dayOfMonth":21}; "on the 3rd" -> {"dayOfMonth":3}. Code picks the most recent past such day, so do NOT work out the date yourself.',
    '- weekend: which past weekend, ONLY when the phrase literally says "weekend". "this weekend" -> {"weekend":"this"}; "last weekend" -> {"weekend":"last"}; "two weekends ago" -> {"weekend":"two-ago"}. Code works out the two dates.',
    '- date: one explicit calendar date. "July 15" -> {"date":"2026-07-15"} (use the year that makes it most recent, never future).',
    '- fromDate + toDate: a calendar span, both inclusive. "april" -> {"fromDate":"2026-04-01","toDate":"2026-04-30"}. "this month" -> the 1st of the current month through today. "this year" -> {"fromDate":"2026-01-01","toDate":"2026-12-31"}. "june 1 to 15" -> both dates. Either side may stand alone: "since july 1" -> {"fromDate":"2026-07-01"}.',
    '- fromTime/toTime: 24h "HH:MM" from 00:00 to 23:59, narrowing ONE day named by daysAgo/weekday/date. "yesterday from 4pm to 10pm" -> {"daysAgo":1,"fromTime":"16:00","toTime":"22:00"}.',
    '- A part of the day is a day plus a clock band: morning 06:00-12:00, noon or lunch 11:00-13:00, afternoon 12:00-18:00, evening 18:00-23:59, night 20:00-23:59. ALWAYS include the day, defaulting to today (daysAgo 0) when none is named: "this morning" -> {"daysAgo":0,"fromTime":"06:00","toTime":"12:00"}; "around noon" -> {"daysAgo":0,"fromTime":"11:00","toTime":"13:00"}; "last night" -> {"daysAgo":1,"fromTime":"20:00","toTime":"23:59"}; "last tuesday night" -> {"weekday":"tuesday","fromTime":"20:00","toTime":"23:59"}.',
    '- none: true when the phrase asks for no time limit. "all time" -> {"none":true}.',
    'Keep BOTH halves of a compound phrase, in any language: a day word and a part of the day both survive. "yesterday evening" -> {"daysAgo":1,"fromTime":"18:00","toTime":"23:59"}; "hier apres-midi" -> {"daysAgo":1,"fromTime":"12:00","toTime":"18:00"}.',
    'The phrase may be in any language: "letzte Woche" -> {"lastCount":1,"lastUnit":"week"}; "ayer" -> {"daysAgo":1}; "ce matin" -> {"daysAgo":0,"fromTime":"06:00","toTime":"12:00"}; "el fin de semana pasado" -> {"weekend":"last"}.',
    'A calendar day word is never a rolling span: "today" is daysAgo 0, NOT lastCount 1 day. A part of the day is never a rolling span either.',
    // The self-explanation, decoded FIRST in every branch (refs #438).
    // Measured: "all this week" decoded none:true (no time limit) without
    // it and a real window with it; restating the meaning puts the phrase's
    // actual coverage in front of the decoder before any field is chosen.
    'ALWAYS fill "meaning" first: one short sentence saying exactly which days (and hours) the phrase covers. Then the fields that express it.',
  ];
}

/** Model-facing (rule 5 exempt): the per-phrase interpreter prompt, used by
 *  the scan fallback and any tool-time cache miss. */
export function buildInterpreterPrompt(now: Date, timezone: string): string {
  return [
    'You convert a human time phrase into a JSON time window. Reply with ONLY one JSON object.',
    ...fieldTeachingLines(now, timezone),
  ].join('\n');
}

/** Model-facing (rule 5 exempt): the whole-question interrogation (refs
 *  #444), the primary time path on every backend. Nothing is copied - the
 *  model expresses each period the question means as one window object -
 *  so the copy-truncation failure class ("same day, last week" -> "last
 *  week") cannot occur. Probed 13/13 on the live-failure matrix. */
export function buildQuestionWindowsPrompt(now: Date, timezone: string): string {
  return [
    'You express every time period one QUESTION means, as a list of JSON time windows. Reply with ONLY one JSON object: {"windows":[...]}, one window object per period the question asks about.',
    ...fieldTeachingLines(now, timezone),
    // The probe's measured tail, in its winning order (refs #444): the
    // anti-attractor rules live HERE and not in the shared lines, because
    // sharing them regressed the per-phrase interpreter (ayer, last tuesday
    // night) while the windows call needs them against rolling collapse.
    '"same day last week" or "a week ago today" -> {"daysAgo":7}: ONE single day, never a rolling span.',
    '"this/last <week, month, year>" means that CALENDAR unit, never a rolling span: "all this week" -> {"week":"this"}; "last month" -> the previous month as fromDate/toDate. Only a counted "past/last N <units>" is rolling. Your fields must express exactly what your own "meaning" sentence says.',
    'A comparison means one window PER compared period: "compare to same day, last week" asked after a question about today is TWO windows - {"daysAgo":0} and {"daysAgo":7} - never one span covering both.',
    'The question may include an earlier exchange for context: a comparison or follow-up can mean a period from that exchange plus a new one - emit BOTH as windows.',
    '"windows" is [] when the question names no time at all.',
    'Every window object starts with its own "meaning" sentence, then the fields. Each "meaning" names exactly ONE period ("today", "the same day one week back") - never the comparison or the question.',
  ].join('\n');
}

/** Whether the question carries any counted-rolling marker ("past 2 weeks",
 *  "last 6 hours", "an hour ago") or a sub-day unit word. The rolling branch
 *  is the decoder's attractor - "what happened today" decoded lastCount 1
 *  day 2/2 with it offered - so, exactly like selectBranches per phrase, the
 *  windows schema offers it only when the question can actually mean one.
 *  English unit words: an unlisted language loses counted-rolling and falls
 *  to a calendar span, never worse than a wrong window. */
const QUESTION_ROLLING_RE =
  /\b(?:past|last|previous)\s+(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:minute|hour|day|week|month|year)s?\b|\b(?:minute|hour)s?\b/i;

export function questionOffersRolling(question: string): boolean {
  return QUESTION_ROLLING_RE.test(question);
}

/** The windows-array schema: each item is one of WINDOW_SCHEMA's own
 *  branches, so a window that no branch can express is undecodable. The
 *  rolling branch rides only when the question shows a rolling marker. */
export function buildQuestionWindowsSchema(offerRolling = true): Record<string, unknown> {
  const branches = (WINDOW_SCHEMA as { anyOf: Array<{ required: string[] }> }).anyOf;
  const offered = offerRolling ? branches : branches.filter((b) => !b.required.includes('lastCount'));
  return {
    type: 'object',
    properties: { windows: { type: 'array', items: { anyOf: offered } } },
    required: ['windows'],
    additionalProperties: false,
  };
}

/** Session cache: the same phrase on the same calendar day means the same
 *  window, and "yesterday"/"today" repeat constantly. */
const CACHE = new Map<string, WindowFields | { error: string }>();

function windowCacheKey(phrase: string, now: Date, timezone: string): string {
  return `${format(toZonedTime(now, timezone), 'yyyy-MM-dd')}::${timezone}::${phrase.trim().toLowerCase()}`;
}

/** Seeds the per-day cache with fields the windows interrogation already
 *  produced (refs #444), keyed by the window's meaning label, so a tool-time
 *  interpretWhen on that label resolves without any model call. */
export function seedInterpreterCache(phrase: string, fields: WindowFields, now: Date, timezone: string): void {
  CACHE.set(windowCacheKey(phrase, now, timezone), fields);
}

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
  const cacheKey = windowCacheKey(phrase, now, timezone);
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  let result: WindowFields | { error: string };
  try {
    const reply = await provider.complete(buildInterpreterPrompt(now, timezone), phrase, signal, selectBranches(phrase));
    const parsed = parseFields(reply.text);
    if (parsed) clampBareMonthEnd(phrase, parsed);
    result = parsed ?? { error: `Could not interpret "${phrase}" as a time window. Rephrase the when argument.` };
  } catch (error) {
    if (isAbortError(error)) throw error;
    log.assistant('Window interpretation failed', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    result = { error: `Could not interpret "${phrase}" as a time window right now. Retry, or rephrase the when argument.` };
  }
  // Only a real interpretation earns a day of reuse (refs #430): a cached
  // error made its own "Retry" advice a lie, since every retry of the phrase
  // served the failure back until the calendar day rolled over. Observed
  // live with "yesterday" after one transient failure during the pre-warm.
  if (!('error' in result)) CACHE.set(cacheKey, result);
  return result;
}

/** The first JSON object in `text` as WindowFields, or undefined. Defensive:
 *  an unconstrained backend may wrap the object in prose. */
/** Exported for the eval harness (prompt-eval.mts time stage): replies MUST
 *  be interpreted through this exact function, never raw-parsed - a field
 *  this parser did not know scored 100% in an eval that bypassed it while
 *  every production call failed (refs #442). */
export function parseFields(text: string): WindowFields | undefined {
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
    // Every field the schema can emit MUST round-trip here: week and the
    // weekday range were taught to the prompt and schema (#435, #439) but
    // not to this parser, so {"week":"this"} parsed to {} and the tool
    // errored "does not name a time period" while the eval - which
    // raw-parsed replies instead of running this function - scored 100%
    // (refs #442).
    if (raw.week !== undefined) fields.week = String(raw.week);
    if (raw.fromWeekday !== undefined) fields.fromWeekday = String(raw.fromWeekday);
    if (raw.toWeekday !== undefined) fields.toWeekday = String(raw.toWeekday);
    if (raw.dayOfMonth !== undefined) fields.dayOfMonth = Number(raw.dayOfMonth);
    // Pass the weekend value through as sent: the schema now emits a string enum
    // ("this"/"last"/"two-ago"), which resolveWindow maps to a weekends-ago
    // number. A legacy numeric weekend still round-trips through resolveWindow.
    if (raw.weekend !== undefined) fields.weekend = typeof raw.weekend === 'number' ? raw.weekend : String(raw.weekend);
    if (raw.date !== undefined) fields.date = String(raw.date);
    if (raw.fromDate !== undefined) fields.fromDate = String(raw.fromDate);
    if (raw.toDate !== undefined) fields.toDate = String(raw.toDate);
    if (raw.fromTime !== undefined) fields.fromTime = String(raw.fromTime);
    if (raw.toTime !== undefined) fields.toTime = String(raw.toTime);
    return repairFields(fields);
  } catch {
    return undefined;
  }
}

/** Undoes the two signatures a constrained decoder leaves under a wide optional
 *  shape, in case a backend emits a mixed object despite the anyOf branches:
 *  a junk-filled `weekend` sitting beside a real day signal (a genuine weekend
 *  phrase produces `weekend` alone), and a `lastCount` with no `lastUnit` (an
 *  uninterpretable half-pair `resolveWindow` could only reject). Dropping each
 *  is safer than passing a mixed shape downstream. */
function repairFields(fields: WindowFields): WindowFields {
  const daySignal =
    fields.daysAgo !== undefined ||
    fields.date !== undefined ||
    fields.weekday !== undefined ||
    fields.dayOfMonth !== undefined ||
    fields.lastCount !== undefined;
  if (fields.weekend !== undefined && daySignal) {
    log.assistant('Dropping junk-filled weekend beside a day signal', LogLevel.DEBUG, { fields: { ...fields } });
    delete fields.weekend;
  }
  if (fields.lastCount !== undefined && fields.lastUnit === undefined) {
    log.assistant('Dropping lastCount without lastUnit', LogLevel.DEBUG, { fields: { ...fields } });
    delete fields.lastCount;
  }
  return fields;
}

/** Corrects the model's exclusive-end habit on a BARE month name. On phrases
 *  with no digits ("last month", "april"), FM tends to send an exclusive toDate
 *  (the 1st of the next month) beside a fromDate on the 1st of the prior month;
 *  resolveWindow treats toDate as inclusive, so that overshoots by a day. When
 *  the phrase names no number and toDate is exactly one month after a first-of-
 *  month fromDate, snap toDate to fromDate's real month end. A phrase that spells
 *  its own dates ("june 1 to july 1") keeps its digits and is never touched. */
function clampBareMonthEnd(phrase: string, fields: WindowFields): void {
  if (/\d/.test(phrase)) return;
  const { fromDate, toDate } = fields;
  if (typeof fromDate !== 'string' || typeof toDate !== 'string') return;
  const from = /^(\d{4})-(\d{2})-01$/.exec(fromDate);
  const to = /^(\d{4})-(\d{2})-01$/.exec(toDate);
  if (!from || !to) return;
  const fromMonths = Number(from[1]) * 12 + Number(from[2]);
  const toMonths = Number(to[1]) * 12 + Number(to[2]);
  if (toMonths - fromMonths !== 1) return;
  // Day 0 of the month AFTER fromDate's month is fromDate's month's last day.
  const lastDay = new Date(Number(from[1]), Number(from[2]), 0).getDate();
  fields.toDate = `${from[1]}-${from[2]}-${String(lastDay).padStart(2, '0')}`;
}
