/**
 * Time-understanding eval cases, the ONE source of truth shared by every runner
 * so none can drift from another (refs #270).
 *
 * Time understanding must be robust to WIDELY VARIED phrasings, proven by
 * measurement across CLASSES of expression rather than by fixing one phrase at
 * a time. These cases are scored by:
 * - `scripts/prompt-eval.mts`, against a live OpenAI-compatible server (Ollama),
 *   measuring the extraction and interpretation PROMPTS directly.
 * - `fm-eval.ts`, through the production stages (`extractTimeframes`,
 *   `interpretWhen`) against any provider, Apple Foundation Models included,
 *   which has no HTTP API the harness could ever reach.
 *
 * Browser-safe: no node imports, so it loads in the app bundle and in the
 * settings-triggered on-device eval. Each interpretation case pairs a phrase
 * with a predicate over the RESOLVED window; each extraction case pairs a
 * question with the phrases the extractor must surface. Predicates are written
 * against the fixed clock the runner pins (fm-eval.ts `FM_EVAL_NOW` /
 * `FM_EVAL_TZ`: Sunday 2026-07-19 14:00 America/New_York), so every date,
 * weekend, and ordinal predicate is deterministic regardless of run date; a
 * Sunday makes "this weekend" the already-past Saturday+Sunday, never a future
 * one. Both runners MUST resolve with that same instant.
 */
import type { ResolvedEventRange } from './event-range';

/** What `resolveWindow` hands back: a concrete range, a corrective error, or
 *  undefined for an unfiltered query. */
export type ResolvedRange = ResolvedEventRange | { error: string } | undefined;

const okRange = (r: ResolvedRange): r is ResolvedEventRange => !!r && !('error' in r);
/** "HH:MM" as minutes past midnight, NaN if malformed. */
const toMin = (s: unknown): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** Clock value within [lo, hi] inclusive: part-of-day predicates accept a band,
 *  not one exact time, so the model has room to map "morning" sensibly. */
const band = (v: unknown, lo: string, hi: string): boolean => {
  const t = toMin(v);
  return Number.isFinite(t) && t >= toMin(lo) && t <= toMin(hi);
};
const startsOn = (r: ResolvedRange, d: string): boolean => okRange(r) && String(r.startDateTime ?? '').startsWith(d);
const endsOnDate = (r: ResolvedRange, d: string): boolean => okRange(r) && String(r.endDateTime ?? '').startsWith(d);
const endsBy = (r: ResolvedRange, iso: string): boolean => okRange(r) && String(r.endDateTime ?? '') <= `${iso} 23:59:59`;
/** Resolved endpoints matched exactly, for cases where the same window is
 *  reachable through more than one branch (daysAgo vs an explicit date) and only
 *  the resolved range, not the raw fields, distinguishes a correct answer. */
const startsAt = (r: ResolvedRange, dt: string): boolean => okRange(r) && r.startDateTime === dt;
const endsAt = (r: ResolvedRange, dt: string): boolean => okRange(r) && r.endDateTime === dt;

export interface TimeInterpretCase {
  /** The human time phrase fed to `interpretWhen`. */
  phrase: string;
  /** Class label, so tallies group by kind of expression. */
  cls: string;
  /** True when the interpreted `fields` (and their `resolveWindow` result)
   *  match what the phrase means. Fields are the raw parsed object, so a
   *  predicate may read `none` even though it is not a `WindowFields` key. */
  ok: (fields: Record<string, unknown>, range: ResolvedRange) => boolean;
}

export interface TimeExtractCase {
  /** The question fed to `extractTimeframes`. */
  question: string;
  /** Class label; defaults to 'extract' when omitted. */
  cls?: string;
  /** Each must appear as a normalized substring of some returned phrase. */
  expect?: string[];
  /** The question names no time: the extractor must fall to the default
   *  'today' (it never returns an empty phrase list unless it abstains). */
  none?: boolean;
}

/** 36 interpretation cases across 10 CLASSES, not variants of one phrase.
 *  Predicates check the RESOLVED range through resolveWindow whenever a window is
 *  reachable through more than one branch (a day as daysAgo, an explicit date, or
 *  the matching weekday all resolve to the same range, and the decoder may send
 *  any of them), so an equivalent-but-different branch is never a false negative.
 *  Raw fields are asserted only where the branch is the crisp contract with no
 *  equivalent (rolling spans, none). */
export const TIME_INTERPRET_CASES: TimeInterpretCase[] = [
  // relative days (checked on the resolved range: "today" is equally correct as
  // daysAgo 0 or as the explicit date 2026-07-19, and the decoder may send either)
  { phrase: 'today', cls: 'relative-day', ok: (_f, r) => startsOn(r, '2026-07-19') },
  { phrase: 'yesterday', cls: 'relative-day', ok: (_f, r) => startsOn(r, '2026-07-18') },
  { phrase: 'the day before yesterday', cls: 'relative-day', ok: (_f, r) => startsOn(r, '2026-07-17') },
  { phrase: '3 days ago', cls: 'relative-day', ok: (_f, r) => startsOn(r, '2026-07-16') },
  // rolling spans
  { phrase: 'past 3 hours', cls: 'rolling', ok: (f) => f.lastUnit === 'hour' && f.lastCount === 3 },
  { phrase: 'last 6 hours', cls: 'rolling', ok: (f) => f.lastUnit === 'hour' && f.lastCount === 6 },
  { phrase: 'past 5 days', cls: 'rolling', ok: (f) => f.lastUnit === 'day' && f.lastCount === 5 },
  { phrase: 'last 2 weeks', cls: 'rolling', ok: (f) => (f.lastUnit === 'week' && f.lastCount === 2) || (f.lastUnit === 'day' && f.lastCount === 14) },
  { phrase: 'past 30 days', cls: 'rolling', ok: (f) => (f.lastUnit === 'day' && f.lastCount === 30) || (f.lastUnit === 'month' && f.lastCount === 1) },
  // part of day (day anchored on the resolved range so a day+clock or date+clock
  // branch both pass; the band stays on the raw times so the model keeps room)
  { phrase: 'this morning', cls: 'part-of-day', ok: (f, r) => startsOn(r, '2026-07-19') && band(f.fromTime, '05:00', '08:00') && band(f.toTime, '11:00', '13:00') },
  { phrase: 'last night', cls: 'part-of-day', ok: (f, r) => startsOn(r, '2026-07-18') && band(f.fromTime, '17:00', '22:00') && band(f.toTime, '22:00', '23:59') },
  { phrase: 'yesterday evening', cls: 'part-of-day', ok: (f, r) => startsOn(r, '2026-07-18') && band(f.fromTime, '17:00', '19:00') && band(f.toTime, '21:00', '23:59') },
  { phrase: 'around noon', cls: 'part-of-day', ok: (f, r) => startsOn(r, '2026-07-19') && band(f.fromTime, '10:00', '12:00') && band(f.toTime, '12:00', '14:00') },
  // weekday references (resolved range, so weekday/daysAgo/date branches all pass)
  { phrase: 'on sunday', cls: 'weekday', ok: (_f, r) => startsOn(r, '2026-07-19') },
  { phrase: 'last tuesday night', cls: 'weekday', ok: (f, r) => startsOn(r, '2026-07-14') && band(f.fromTime, '17:00', '23:00') },
  // weekday ranges (refs #434): the fromWeekday/toWeekday branch exists so
  // the model never computes the dates; checked on the resolved range.
  { phrase: 'between mon and tue', cls: 'weekday', ok: (_f, r) => startsOn(r, '2026-07-13') },
  { phrase: 'from friday to sunday', cls: 'weekday', ok: (_f, r) => startsOn(r, '2026-07-17') },
  // lunch is a part-of-day band (refs #434)
  { phrase: 'at lunch 5 days ago', cls: 'part-of-day', ok: (f, r) => startsOn(r, '2026-07-14') && band(f.fromTime, '10:00', '12:00') && band(f.toTime, '12:00', '14:00') },
  // weekend (code computes the two dates from the `weekend` field; resolved
  // range checked so either the field or a correct fromDate/toDate passes)
  { phrase: 'this weekend', cls: 'weekend', ok: (_f, r) => startsOn(r, '2026-07-18') && endsOnDate(r, '2026-07-19') },
  { phrase: 'last weekend', cls: 'weekend', ok: (_f, r) => startsOn(r, '2026-07-11') && endsOnDate(r, '2026-07-13') },
  // ordinal / partial dates
  { phrase: 'the 21st', cls: 'ordinal-date', ok: (_f, r) => startsOn(r, '2026-06-21') },
  { phrase: 'July 15', cls: 'ordinal-date', ok: (_f, r) => startsOn(r, '2026-07-15') },
  { phrase: 'June 1 to 15', cls: 'ordinal-date', ok: (f) => f.fromDate === '2026-06-01' && f.toDate === '2026-06-15' },
  // month / year spans (resolved range: the model may over-count a month end,
  // which resolveWindow clamps to the real last day)
  { phrase: 'april', cls: 'month-year', ok: (_f, r) => startsOn(r, '2026-04-01') && endsOnDate(r, '2026-05-01') },
  { phrase: 'february', cls: 'month-year', ok: (_f, r) => startsOn(r, '2026-02-01') && endsOnDate(r, '2026-03-01') },
  { phrase: 'this month', cls: 'month-year', ok: (f, r) => f.fromDate === '2026-07-01' && endsBy(r, '2026-07-19') },
  { phrase: 'last month', cls: 'month-year', ok: (f) => (f.fromDate === '2026-06-01' && f.toDate === '2026-06-30') || (f.lastUnit === 'month' && f.lastCount === 1) },
  { phrase: 'this year', cls: 'month-year', ok: (f, r) => f.fromDate === '2026-01-01' && endsBy(r, '2026-07-19') },
  { phrase: 'since july 1', cls: 'month-year', ok: (f) => f.fromDate === '2026-07-01' && (f.toDate === undefined || String(f.toDate) >= '2026-07-19') },
  // clock ranges (resolved endpoints: a date branch that lands on the same day is
  // as correct as daysAgo, so "yesterday" as 2026-07-18 passes on the range)
  { phrase: 'yesterday from 4pm to 10pm', cls: 'clock-range', ok: (_f, r) => startsAt(r, '2026-07-18 16:00:00') && endsAt(r, '2026-07-18 22:00:00') },
  { phrase: 'today between 9am and 5pm', cls: 'clock-range', ok: (_f, r) => startsAt(r, '2026-07-19 09:00:00') && endsAt(r, '2026-07-19 17:00:00') },
  // no time (production's parseFields maps none:true -> {}; accept either shape)
  { phrase: 'all time', cls: 'no-time', ok: (f) => f.none === true || Object.keys(f).length === 0 },
  { phrase: 'ever', cls: 'no-time', ok: (f) => f.none === true || Object.keys(f).length === 0 },
  // non-English (de / es / fr)
  { phrase: 'letzte Woche', cls: 'non-english', ok: (f) => (f.lastUnit === 'week' && f.lastCount === 1) || (f.lastUnit === 'day' && f.lastCount === 7) },
  { phrase: 'ayer', cls: 'non-english', ok: (_f, r) => startsOn(r, '2026-07-18') },
  { phrase: 'ce matin', cls: 'non-english', ok: (f, r) => startsOn(r, '2026-07-19') && band(f.fromTime, '05:00', '08:00') && band(f.toTime, '11:00', '13:00') },
  { phrase: 'el fin de semana pasado', cls: 'non-english', ok: (_f, r) => startsOn(r, '2026-07-11') && endsOnDate(r, '2026-07-13') },
  { phrase: 'hier soir', cls: 'non-english', ok: (f, r) => startsOn(r, '2026-07-18') && band(f.fromTime, '17:00', '20:00') && toMin(f.toTime) >= toMin('21:00') },
  { phrase: 'vorgestern', cls: 'non-english', ok: (_f, r) => startsOn(r, '2026-07-17') },
];

/** 16 extraction cases: multiple time expressions in one question, time words
 *  embedded mid-sentence, zero-time questions, one non-English.
 *
 *  A compact clock range on its own ("10am-6pm", "9-5") resolves to an error by
 *  design: a bare time-of-day has no day to anchor it. Extraction must still
 *  surface it verbatim, because the token-level provenance layer (the answering
 *  model copies allowed phrases into `when`) lets the model legally compose it
 *  with a day word drawn from the same question ("10am-6pm" + "yesterday"). */
export const TIME_EXTRACT_CASES: TimeExtractCase[] = [
  { question: 'what happened today', expect: ['today'] },
  { question: 'compare today and yesterday', expect: ['today', 'yesterday'] },
  { question: 'summarize the past 2 weeks', expect: ['past 2 weeks'] },
  // The "<n> <unit> ago" family: the interpret cases below have carried
  // "3 days ago" all along, but nothing checked that the scan FINDS it in a
  // question, so the whole family fell through to the today default (refs #310).
  { question: 'what was the busiest hour 2 days ago?', expect: ['2 days ago'] },
  { question: 'anything two days ago', expect: ['two days ago'] },
  { question: 'what happened 3 hours ago', expect: ['3 hours ago'] },
  { question: 'how many people came this morning and this evening', expect: ['this morning', 'this evening'] },
  { question: 'show me events from july 15 and july 21', expect: ['july 15', 'july 21'] },
  { question: 'anything between june 1 and june 15', expect: ['june 1', 'june 15'] },
  { question: 'who came by yesterday from 4pm to 10pm', expect: ['yesterday', '4pm', '10pm'] },
  // Compact clock ranges: a dash form and a bare "between X and Y", each with a
  // day word the range attaches to.
  { question: 'Compare 10am-6pm yesterday and today.', expect: ['10am-6pm', 'yesterday', 'today'] },
  { question: 'anything between 9-5 today', expect: ['9-5', 'today'] },
  { question: 'were there cars in the driveway yesterday afternoon', expect: ['yesterday', 'afternoon'] },
  { question: 'give me a recap of last month', expect: ['last month'] },
  { question: 'how busy was it in april', expect: ['april'] },
  // Weekday ranges and the month-word guard (refs #434): the range phrase
  // must surface whole, and the "may" typo must not scan as a month (the
  // guard is unit-tested; here the range keeps the case answerable).
  { question: 'who came by between mon and tue?', expect: ['between mon and tue'] },
  { question: 'How may folks came to the front of my house between mon and tue?', expect: ['between mon and tue'] },
  { question: 'who came at lunch 5 days ago', expect: ['lunch', '5 days ago'] },
  { question: 'was war letzte Woche bei mir los', expect: ['letzte woche'] },
  { question: 'what cameras do I have', none: true },
  { question: 'is the server ok', none: true },
  { question: 'list all my monitors', none: true },
];
