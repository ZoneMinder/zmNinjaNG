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
import { interpretWhen } from './window-interpreter';
import { log, LogLevel } from '../logger';
import type { AssistantProvider } from './types';

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
    'List every time expression the question contains in "phrases", each copied VERBATIM and in the',
    'user\'s own language ("today", "yesterday", "last week", "July 21", "letzte Woche", "from 4pm to 10pm").',
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

export interface ExtractedTimeframes {
  /** The resolved phrases to copy into `when`; the "today" default when the
   *  question named no time. Empty only when `abstained` is true. */
  phrases: string[];
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
  let extracted: string[] = [];
  try {
    const reply = await provider.complete(buildTimeframePrompt(now, timezone), question, signal, TIMEFRAME_SCHEMA);
    extracted = parsePhrases(reply.text);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // A failed extraction cannot tell time words apart from none: fall open to
    // the default period rather than blocking the turn (the `when` provenance
    // guard still protects the tool call). The tool round would fail the same
    // way if the model were truly unreachable.
    log.assistant('Timeframe extraction failed', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { phrases: ['today'], abstained: false };
  }

  const namedTime = extracted.length > 0;
  // De-dupe on the normalized form: the same phrase twice would resolve twice
  // (cache makes the second free) and clutter the allowed-phrase line.
  const seen = new Set<string>();
  const candidates = (namedTime ? extracted : ['today']).filter((phrase) => {
    const key = phrase.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const resolved: string[] = [];
  for (const phrase of candidates) {
    const fields = await interpretWhen(phrase, provider, now, timezone, signal);
    if ('error' in fields && fields.error) continue;
    resolved.push(phrase);
  }

  if (resolved.length === 0) {
    // Two ways here: a stated timeframe that all failed (abstain), or the
    // "today" default itself failing to resolve (keep it, so the answering
    // model still has an allowed phrase and the turn proceeds on today).
    return namedTime ? { phrases: [], abstained: true } : { phrases: ['today'], abstained: false };
  }
  return { phrases: resolved, abstained: false };
}
