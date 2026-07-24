/**
 * Shared helpers for assistant tool executors (refs #246).
 */
import { log, LogLevel } from '../logger';
import { ASSISTANT } from '../zmninja-ng-constants';
import type { DisplayEntity, ResolvedTimeframe, ToolExecuteResult } from './types';

/** Lowercased, trimmed, single-spaced form of a `when` phrase, for comparing
 *  it against the question it should have come from. Shared so the pre-tool
 *  parrot filter (timeframe-stage.ts) and the provenance guard below normalize
 *  identically. */
export function normalizeWhenPhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Literal strings a model emits for an OPTIONAL argument it means to leave
 *  out. Small models routinely send `"null"` (or `"undefined"`, `"none"`,
 *  `"all"`, `"any"`, `""`) instead of omitting the key, so a tool must read
 *  these as "no value" rather than a real one, or it queries for a monitor
 *  named "null" and fails (refs #246). */
const OMITTED_ARG_VALUES = new Set([
  '', 'null', 'undefined', 'none', 'n/a', 'na', 'all', 'any',
  // Empty JSON literals, as strings. Ollama's native tool-calling serializes
  // `arguments` as a JSON STRING, and llama3.2 fills an argument it means to
  // leave out with "{}" or "[]". Treated as a real label, "{}" was rejected as
  // an unknown object type and the turn looped on the rejection.
  '{}', '[]', '{ }', '[ ]',
]);

/** Whether a model-supplied optional argument should be treated as absent.
 *  True for undefined/null and for the placeholder strings above. */
export function isOmittedArg(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return OMITTED_ARG_VALUES.has(String(value).trim().toLowerCase());
}

/**
 * Checks a model-proposed tool input against the tool's own schema BEFORE the
 * tool runs, returning a correction message or undefined if it is usable.
 *
 * This is the refine step between "the model picked a tool" and "the tool
 * runs". Without it the loop went straight from proposal to execution, and
 * every tool had to re-discover bad input on its own, after a request was
 * already in flight. Measured against llama3.2, the arguments that actually
 * turn up are `range: "yesterday from 16:00 to 22:00"` (prose in an enum
 * field) and `endTime: "today"` (a range keyword in a datetime field): both
 * are decidable from the schema alone, with no round trip and no network call.
 *
 * Deliberately partial, not a JSON Schema implementation: enum membership,
 * primitive type, required presence, and unknown keys are the mistakes small
 * models actually make. Anything subtler stays the executor's job.
 *
 * The message is written FOR THE MODEL: it names the argument, what was wrong,
 * and the values that would be accepted, because it comes back as a tool
 * result the model has to correct from.
 */
export function validateToolInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): string | undefined {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];

  for (const name of required) {
    if (isOmittedArg(input[name])) return `${name} is required, but was not provided.`;
  }

  for (const [name, value] of Object.entries(input)) {
    const spec = properties[name];
    if (!spec) {
      // Only when the schema says so, matching JSON Schema semantics rather
      // than assuming every tool is closed.
      if (schema.additionalProperties === false) {
        return `${name} is not an argument of this tool. Valid arguments: ${Object.keys(properties).join(', ') || 'none'}.`;
      }
      continue;
    }
    // A placeholder on an OPTIONAL argument means "left out" (see
    // isOmittedArg), so it must not be type- or enum-checked as a real value.
    if (isOmittedArg(value) && !required.includes(name)) continue;

    const allowed = spec.enum as readonly unknown[] | undefined;
    if (Array.isArray(allowed) && !allowed.includes(value)) {
      return `${name} must be one of: ${allowed.map(String).join(', ')}. Received "${String(value)}".`;
    }

    // A property may accept more than one type (objectType takes a label or a
    // list of them), so this is always a set.
    const expected = (Array.isArray(spec.type) ? spec.type : spec.type ? [spec.type] : []) as string[];
    if (expected.length === 0) continue;

    const actual = Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value;
    // Only a STRING may coerce to number: `Number([])` is 0 and `Number(null)`
    // is 0, so anything looser lets `limit: []` through as a "number".
    const numericString = typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value));
    if (expected.includes('number') && expected.length === 1 && typeof value !== 'number' && !numericString) {
      return `${name} must be a number. Received "${String(value)}".`;
    }
    if (expected.includes('array') && actual === 'array') continue;
    if (expected.includes('string') && actual === 'string') continue;
    if (expected.includes('number') && (actual === 'number' || numericString)) continue;
    return `${name} must be ${expected.join(' or ')}. Received ${actual}.`;
  }

  return undefined;
}

/** One or more model-supplied labels as a `Notes REGEXP` fragment.
 *
 *  No category map and no plural rules: the model is given this install's real
 *  vocabulary in the system prompt (see object-labels.ts) and picks the labels
 *  itself, so "vehicles" arrives here as ["car","truck"] chosen from labels
 *  that actually exist. A hardcoded taxonomy could only ever guess at someone
 *  else's detector, and missed `truck` on this very install.
 *
 *  Metacharacters are stripped because the result is spliced into a regex the
 *  SERVER runs: a label is a plain word, and anything else is either a mistake
 *  or an injection into someone else's query engine. */
/** The labels a model meant, however it serialized them.
 *
 *  A real array passes through. A STRING holding a list does not: Ollama sends
 *  tool `arguments` as a JSON string, and llama3.2 stringified the array
 *  inside it, so `objectType` arrived as the literal text `['car', 'truck']`.
 *  Read as one label that was rejected as unknown, and the turn looped. The
 *  same model on the on-device path sends a real array, because that path
 *  parses one JSON object rather than a string inside one: the malformation is
 *  a property of the wire format, not of the model.
 *
 *  Python-style single quotes are accepted alongside JSON, since that is what
 *  actually arrives. */
export function coerceLabelList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  const text = String(value ?? '').trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return text ? [text] : [];
  // Strict JSON first: the global quote swap below corrupts a label that
  // legitimately contains an apostrophe, so it only runs when real JSON failed.
  for (const candidate of [text, text.replace(/'/g, '"')]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      // Fall through: try the quote-swapped form, then the split below.
    }
  }
  return text
    .replace(/^[[{]|[\]}]$/g, '')
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
}

export function objectTypePattern(objectType: string | readonly string[]): string {
  // Unicode letters and digits survive, not just ASCII: a detector writing
  // non-Latin labels used to normalize to '' here, which silently dropped the
  // object filter and presented unfiltered rows as the filtered result.
  const labels = coerceLabelList(objectType)
    .map((value) => value.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, ''))
    .filter((value) => value.length > 0);
  if (labels.length === 0) return '';
  return labels.length === 1 ? labels[0] : `(${labels.join('|')})`;
}

/** Common category words a user says mapped onto the object labels an
 *  installation might record.
 *
 *  The map expands COMMON category words (the words a user actually says, like
 *  "vehicle" or "anyone") onto candidate labels; `matchLabels` then intersects
 *  every expansion with the labels THIS installation actually records, so the
 *  map never invents a label and nothing is hardcoded about a given detector.
 *  It only says which words might mean the same thing, not what any detector
 *  emits. Member labels double as reverse lookups: a member word ("bus") the
 *  install does not record maps through its category to the ones it does. */
const CATEGORY_LABEL_SETS: Readonly<Record<string, readonly string[]>> = {
  vehicle: ['car', 'truck', 'bus', 'boat', 'motorcycle', 'bicycle', 'van'],
  person: ['person'],
  people: ['person'],
  human: ['person'],
  humans: ['person'],
  anyone: ['person'],
  somebody: ['person'],
  someone: ['person'],
  animal: ['dog', 'cat', 'bird', 'horse', 'cow', 'sheep', 'bear', 'deer'],
};

/** Two words are the same label ignoring a simple singular/plural difference
 *  ("car"/"cars", "bus"/"buses"). No irregular forms: "people" is handled by
 *  the category map, not here. */
function sameLabelWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (`${a}s` === b || `${b}s` === a) return true;
  if (`${a}es` === b || `${b}es` === a) return true;
  return false;
}

/** The candidate label set for a category word, whether it is a category key
 *  ("vehicle") or a member of one ("car"). Plural-tolerant on the key. */
function categoryLabelsFor(word: string): readonly string[] | undefined {
  for (const [key, set] of Object.entries(CATEGORY_LABEL_SETS)) {
    if (sameLabelWord(key, word)) return set;
  }
  for (const set of Object.values(CATEGORY_LABEL_SETS)) {
    if (set.some((member) => sameLabelWord(member, word))) return set;
  }
  return undefined;
}

/**
 * Matches the user's OWN object words to the labels an installation actually
 * records, fuzzily: "vehicles" onto whatever vehicle labels exist (car, truck),
 * "anyone" onto person, "animals" onto dog/cat, and exact/plural labels
 * straight through.
 *
 * Each requested word matches the real labels directly first (exact or
 * singular/plural), and only expands through `CATEGORY_LABEL_SETS` when no real
 * label matched it. Every expansion is intersected with `available`, so a
 * category word yields only the labels this detector really writes and never an
 * invented one. Words nothing matches come back in `unmatched`, for the caller
 * to reject with the real vocabulary.
 */
export function matchLabels(
  requested: readonly string[],
  available: readonly string[],
): { matched: string[]; unmatched: string[] } {
  const avail = available.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0);
  const matched = new Set<string>();
  const unmatched: string[] = [];

  for (const raw of requested) {
    const word = raw.trim().toLowerCase();
    if (word.length === 0) continue;

    const direct = avail.filter((a) => sameLabelWord(a, word));
    if (direct.length > 0) {
      direct.forEach((a) => matched.add(a));
      continue;
    }

    const category = categoryLabelsFor(word);
    const expanded = category ? avail.filter((a) => category.some((member) => sameLabelWord(a, member))) : [];
    if (expanded.length > 0) {
      expanded.forEach((a) => matched.add(a));
      continue;
    }

    unmatched.push(raw.trim());
  }

  return { matched: [...matched], unmatched };
}

/** Category words the system prompt itself teaches the model to map onto
 *  labels (see `buildObjectLabelLine`). Kept beside that instruction rather
 *  than guessed at: these are OUR words, not an attempt to enumerate a
 *  detector's vocabulary. */
const CATEGORY_WORDS = ['vehicle', 'animal', 'people', 'person', 'package'];

/**
 * Refusal text when a tool cannot answer the question being asked, or
 * undefined when the pairing is fine.
 *
 * Only `count_events` today, and only for object-type questions: it returns
 * per-monitor COUNTS and nothing about what was detected. Its description says
 * that in capitals, the system prompt repeats it, and asked "how many vehicles
 * came today vs yesterday" the model called it regardless and reported all 14
 * events of every kind as vehicles. Every rule that failed here was advice;
 * this is the same rule where the model cannot route around it.
 *
 * The words come from the install's own vocabulary plus the category words the
 * prompt teaches, so nothing is hardcoded about what a given detector emits.
 */
/** The object word a question actually names, or undefined when it names none:
 *  an install label ("person", "car") or a category word the prompt teaches
 *  ("vehicle", "animal"), plural-tolerant. Extracted so the count_events
 *  mismatch guard and the list_events objectType-strip repair decide "does this
 *  question mention an object" from exactly the same vocabulary. */
export function questionNamesObject(question: string, objectLabels: readonly string[]): string | undefined {
  const asked = question.toLowerCase();
  const words = [...objectLabels.map((l) => l.toLowerCase()), ...CATEGORY_WORDS];
  return words.find((word) => new RegExp(`\\b${word}s?\\b`).test(asked));
}

/**
 * Whether a list_events `objectType` is ungrounded in the question: the question
 * names no object this install records, no category word the prompt teaches, AND
 * none of the model's own objectType labels appears in it verbatim.
 *
 * The model repeats a rejected call verbatim rather than correcting it (observed
 * live: nine identical list_events {"objectType":["person"]} retries to budget
 * death on a plain "summarize today"). An ungrounded filter is spurious, not
 * ambiguous, so it is computable: the executor drops it and runs the summary
 * once, mirroring `repairCountEventsInterval`.
 *
 * The verbatim check keeps a genuine but UNRECORDED object the user actually
 * named ("did a unicorn appear yesterday"): that stays for `matchLabels` to
 * reject with the real vocabulary, rather than being silently dropped here.
 */
export function objectTypeUngrounded(
  question: string | undefined,
  objectType: string | readonly string[],
  objectLabels: readonly string[],
): boolean {
  if (!question) return false;
  if (questionNamesObject(question, objectLabels)) return false;
  const asked = question.toLowerCase();
  return !coerceLabelList(objectType)
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label.length > 0)
    .some((label) => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(asked));
}

export function objectQuestionMismatch(
  toolName: string,
  question: string,
  objectLabels: readonly string[],
): string | undefined {
  if (toolName !== 'count_events') return undefined;

  const named = questionNamesObject(question, objectLabels);
  if (!named) return undefined;

  return (
    `count_events cannot answer this question: it returns event counts only and reports nothing about what ` +
    `was detected, so it cannot tell you how many "${named}" there were. Call list_events instead, with ` +
    `when set to the period asked about and objectType set to the matching label or labels. Do not report ` +
    `any number from count_events as a count of "${named}".`
  );
}

/**
 * Corrective text when `count_events` is asked for a calendar-based period it
 * cannot express, or undefined when a rolling window is present (or nothing was
 * resolved).
 *
 * `count_events` counts a ROLLING window ending now (lastCount+lastUnit); it
 * cannot express a calendar day like "today" (since local midnight) or
 * "yesterday". The pre-tool stage already resolved this turn's timeframes
 * (timeframe-stage.ts), so their shape is decidable in code: if NONE is a
 * rolling window, the question's period is calendar-based and count_events
 * would answer a rolling 24h window and report it as the calendar day.
 * Observed live: asked about today at 6:53 AM, count_events lastCount 1 day
 * (mostly yesterday evening) returned 29 events on a day that had none.
 *
 * Absent `resolvedTimeframes` (other callers, tests) leaves the call untouched.
 */
export function calendarTimeframeMismatch(resolvedTimeframes: ResolvedTimeframe[] | undefined): string | undefined {
  if (!resolvedTimeframes || resolvedTimeframes.length === 0) return undefined;
  const isRolling = (fields: ResolvedTimeframe['fields']) =>
    fields.lastCount !== undefined && fields.lastUnit !== undefined;
  if (resolvedTimeframes.some((tf) => isRolling(tf.fields))) return undefined;
  const phrase = resolvedTimeframes[0].phrase;
  return (
    `This question's time period is calendar-based ("${phrase}"); count_events counts a rolling window ` +
    `ending now and cannot express it; call list_events with when "${phrase}" instead.`
  );
}

/**
 * Corrective text when a `when` phrase did not come from the question being
 * answered, or undefined when its provenance checks out.
 *
 * Observed live: after a few turns about yesterday, the user asked "summarize
 * today" and the model called list_events with `when: "yesterday"`, then
 * answered about the wrong day with real data, which reads as correct. The
 * phrase came from the conversation history, not from the question.
 *
 * The design contract makes that checkable. `when` is specified as a verbatim
 * copy of the user's own time words in their own language, so a phrase that
 * really came from this question is a substring of it. That test needs no
 * phrase grammar and no language list, which is why it can be applied at all.
 *
 * `allowedPhrases` are the timeframes the pre-tool stage already resolved for
 * this turn (timeframe-stage.ts). A phrase matching one of them passes even
 * when it is not in the question: that is how the default-today case is legal,
 * where the stage resolved "today" though the user never typed it.
 */
export function whenNotFromQuestion(
  whenPhrase: string,
  question: string | undefined,
  allowedPhrases?: string[],
): string | undefined {
  if (!question) return undefined;
  const normalizedWhen = normalizeWhenPhrase(whenPhrase);
  if (normalizeWhenPhrase(question).includes(normalizedWhen)) return undefined;
  if (allowedPhrases?.some((phrase) => normalizeWhenPhrase(phrase) === normalizedWhen)) return undefined;

  return (
    `The when value "${whenPhrase}" does not appear in the question you are answering. ` +
    `when must copy the user's own time words from THIS question, verbatim and in their language, ` +
    `never time words from earlier turns. The question is: "${question}". ` +
    `Retry with the time words copied from it, or omit when entirely if it names no time.`
  );
}

/**
 * The resolved timeframe a stray list_events `when` should be corrected TO, or
 * undefined to leave the call for `whenNotFromQuestion` to reject.
 *
 * The model repeats a rejected call verbatim rather than correcting it: after
 * `whenNotFromQuestion` refused `when: "yesterday"` on "summarize today", the
 * model resent the identical call nine times to budget exhaustion and the turn
 * died with no data. When the pre-tool stage resolved exactly ONE timeframe for
 * this turn there is no ambiguity about the period meant, so the right `when` is
 * computable: return that phrase and let the call run, converting the death loop
 * into one grounded call the way `repairCountEventsInterval` does.
 *
 * Undefined when the phrase already checks out (no repair needed), or when the
 * turn resolved zero or several timeframes: several is genuinely ambiguous and
 * keeps the existing rejection; zero means no stage ran, leaving prior behavior.
 */
export function repairWhenPhrase(
  whenPhrase: string,
  question: string | undefined,
  allowedPhrases?: string[],
): string | undefined {
  if (!whenNotFromQuestion(whenPhrase, question, allowedPhrases)) return undefined;
  return allowedPhrases?.length === 1 ? allowedPhrases[0] : undefined;
}

/**
 * Drops every argument the model meant to leave out, before the tool sees it.
 *
 * Each tool used to do this itself, one argument at a time, and each one that
 * was forgotten became a crash: `eventIds: null` reached the api layer, whose
 * guard reads `!== undefined`, and `null.length` threw
 * "Cannot read properties of null". The model fills unused arguments with
 * `null`, `""`, `"{}"` and friends constantly (see `isOmittedArg`), so this is
 * not an edge case, and a per-tool defence only holds until the next argument
 * is added.
 *
 * Stripped here, an omitted argument is genuinely absent, which is what every
 * downstream `?? default` and `!== undefined` check already assumes.
 */
export function stripOmittedArgs(input: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isOmittedArg(value)) continue;
    // An empty array is a filter that matches nothing, which is never what the
    // model means by sending one.
    if (Array.isArray(value) && value.length === 0) continue;
    kept[key] = value;
  }
  return kept;
}

/** MySQL DATE_SUB interval unit words the model echoes back. Kept beside the
 *  repair below because they are the exact shapes `count_events`'s executor
 *  builds internally, not an open grammar. */
const INTERVAL_STRING = /^\s*(\d+)\s+(minute|hour|day|week|month)s?\s*$/i;

/**
 * Repairs a `count_events` input where the model handed back the tool's OWN
 * internal MySQL-interval shape instead of the schema arguments.
 *
 * The executor builds a `${lastCount} ${lastUnit}` string (e.g. "1 day") for a
 * `DATE_SUB(..., INTERVAL ...)` clause. Small models see that string echoed in
 * the trace and call the tool with `{"interval":"1 day"}`, a field the schema
 * does not have, missing the `lastCount`+`lastUnit` it requires. With
 * `additionalProperties: false` the validator rejects it, and weak models
 * (observed on Apple Foundation Models and qwen) never find their way back to
 * the real arguments. Split the interval into the two schema fields it maps to,
 * before validation, so the call runs instead of looping on the rejection.
 *
 * Only fires when `interval` is a string of that shape AND `lastCount` was not
 * already supplied: a model that sent the correct arguments is left untouched.
 */
export function repairCountEventsInterval(input: Record<string, unknown>): Record<string, unknown> {
  if (input.lastCount !== undefined) return input;
  const match = typeof input.interval === 'string' ? INTERVAL_STRING.exec(input.interval) : null;
  if (!match) return input;
  const { interval: _dropped, ...rest } = input;
  return { ...rest, lastCount: Number(match[1]), lastUnit: match[2].toLowerCase() };
}

/** A stable identity for one tool call, so the same call twice in a turn is
 *  recognised however the model spelled it.
 *
 *  The raw `JSON.stringify(input)` was not that. Ollama sent
 *  `{"monitorId":"","when":"yesterday","objectType":""}` and then
 *  `{"when":"yesterday"}`: the same query, since an empty string means "left
 *  out" (see `isOmittedArg`), but two different strings. The repeat guard did
 *  not fire, the identical query ran again, and the turn went round twice more
 *  before anything noticed. Omitted arguments are dropped and the rest sorted,
 *  so key order and placeholder spelling cannot disguise a repeat. */
export function toolCallSignature(name: string, input: Record<string, unknown>): string {
  const meaningful = Object.entries(input)
    .filter(([, value]) => !isOmittedArg(value))
    .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${name}:${JSON.stringify(meaningful)}`;
}

/** Routes the assistant may send the user to. Anything else is rejected
 *  before `ctx.host.navigate` is ever called. */
export const NAVIGATE_ALLOWLIST = [
  /^\/monitors$/, /^\/monitors\/[^/]+$/, /^\/events$/, /^\/events\/[^/]+$/,
  /^\/montage$/, /^\/timeline$/, /^\/dashboard$/, /^\/server$/,
];

/** A tool's `run` callback may return a bare output string, or (refs #246)
 *  an output plus UI-only result cards for the ones that look up events or
 *  monitors. Deliberately no `isError`: throwing is the only way to produce an
 *  error result (see `safeExecute`), so a `run` that wants the model to see a
 *  failure must throw rather than return. */
export interface SafeExecuteOutput {
  output: string;
  display?: DisplayEntity[];
}

/** Runs `run`, turning a thrown error into an `isError` result instead of
 *  letting it escape into the agent loop. */
export async function safeExecute(
  name: string,
  run: () => Promise<string | SafeExecuteOutput>,
): Promise<ToolExecuteResult> {
  try {
    const result = await run();
    const output = typeof result === 'string' ? result : result.output;
    const boundedOutput =
      output.length <= ASSISTANT.maxToolResultCharacters
        ? output
        : JSON.stringify({
            truncated: true,
            message: 'Tool output exceeded the context budget. Use a narrower filter or fetch one item.',
            preview: output.slice(0, ASSISTANT.maxToolResultCharacters - 200),
          });
    return typeof result === 'string'
      ? { output: boundedOutput }
      : { output: boundedOutput, display: result.display };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // `message`, not `err`: an Error has no own enumerable properties, so the
    // structured field serialized to `{}` and every tool failure logged
    // without saying what went wrong.
    log.assistant(`Tool "${name}" failed`, LogLevel.ERROR, { toolName: name, error: message });
    return { output: message, isError: true };
  }
}
