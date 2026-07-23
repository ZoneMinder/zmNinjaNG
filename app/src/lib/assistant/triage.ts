/**
 * Decides what KIND of request this is before any tool is offered (refs #246).
 *
 * The agent loop hands the model every tool on every turn, so "hello" was
 * answered with `navigate({"path":"/home"})` and "arm the backyard camera"
 * with `get_monitor`: given a tool list and no reason to use it, a small model
 * uses it anyway. Measured on llama3.2, those two cases failed 3/3 each, and
 * no amount of prompt rules fixed them (removing or adding rules moved the
 * score in the wrong direction).
 *
 * So the request is classified first, with NO tools in the prompt at all, and
 * only a ZoneMinder question ever reaches the tool-calling loop. The other two
 * kinds are answered as plain text, which is what they always needed.
 *
 * The cost is one extra round trip. It is kept small deliberately: no tool
 * catalog, no few-shot block, no history, and a one-word reply, so the call is
 * dominated by prefill rather than generation even on the native path.
 */
import type { AssistantMessage, AssistantProvider, AssistantStatus, TraceEntry } from './types';
import { sanitizeModelText } from './sanitize';

export type RequestKind = 'zoneminder' | 'chat' | 'action';

/** Model-facing (rule 5 exempt): never rendered, only matched below.
 *
 *  Written as a RULE over two orthogonal dimensions (what is wanted done,
 *  and what it concerns), not as example instances (refs #265). The old
 *  instance list ("how many people came by today") taught the classifier a
 *  handful of verb-times-time combinations, and every combination outside it
 *  misclassified: "summarize yesterday", "summarize last week", and
 *  "summarize this month" all went to CHAT, one after another, because no
 *  example looked like an imperative or mentioned a week. The time span is
 *  the interpreter's job and never decides the category, and the prompt now
 *  says exactly that; the template examples ("summarize <any period>") show
 *  the shape of the rule rather than enumerate its instances. */
const TRIAGE_PROMPT = [
  'You classify one user message for a ZoneMinder security-camera app. Reply with EXACTLY one word.',
  '',
  'Decide by WHAT THE USER WANTS DONE and WHAT IT CONCERNS, whatever language the message is in:',
  'classify its meaning, not its words. Asking what happened at their place or home means this',
  'camera system. A time span in the message (today, last week, this month, an hour, any custom',
  'range) NEVER changes the category.',
  '',
  'ZONEMINDER - any request to summarize, recap, count, list, look up, check, or view THIS system\'s',
  '  cameras, monitors, events, detections, recordings, activity, or server health, or to be taken to a',
  '  screen in the app. Questions and commands alike, in any language: "summarize <any period>",',
  '  "what happened <any period>", "how many <thing> <any period>", "is the server ok",',
  '  "show me <camera>".',
  'ACTION - a request to CHANGE something here: arm or disarm a monitor, enable or disable a camera,',
  '  trigger or cancel an alarm, change the run state or a monitor function, delete or archive an event.',
  'CHAT - anything NOT about this system: greetings, thanks, small talk, questions about you, general',
  '  knowledge, or summarizing something that is not this system\'s activity.',
  '',
  'Reply with one word: ZONEMINDER, ACTION, or CHAT.',
].join('\n');

/** The verdict as a schema, for a backend that can constrain generation to it
 *  (see `AssistantProvider.complete`). Constrained, the reply is exactly
 *  `{"kind":"CHAT"}` and the substring fallback below never guesses. */
export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: { kind: { type: 'string', enum: ['ZONEMINDER', 'ACTION', 'CHAT'] } },
  required: ['kind'],
  additionalProperties: false,
} as const;

/** A schema-constrained backend replies `{"kind":"CHAT"}`; that is read
 *  first. Everything else is matched loosely on purpose: a small model asked
 *  for one word still says "CHAT." or `{"answer":"CHAT"}` (the on-device
 *  paths wrap every reply in that envelope), so the decision is which keyword
 *  appears, not whether the reply is clean. ZONEMINDER wins ties: routing a
 *  real question to the chat path would answer it with no data at all, which
 *  is the worse failure. */
/** The triage prompt, exported for the eval harness (scripts/prompt-eval.mts
 *  triage stage) so the classifier is scored on exactly what production
 *  sends. Not used elsewhere. */
export const TRIAGE_PROMPT_FOR_EVAL = TRIAGE_PROMPT;

export function parseRequestKind(reply: string): RequestKind {
  try {
    const kind = (JSON.parse(reply) as { kind?: unknown }).kind;
    if (typeof kind === 'string') return parseKindWord(kind);
  } catch {
    // Not the constrained shape; fall through to the loose match.
  }
  return parseKindWord(reply);
}

function parseKindWord(text: string): RequestKind {
  const upper = text.toUpperCase();
  if (upper.includes('ZONEMINDER')) return 'zoneminder';
  if (upper.includes('ACTION')) return 'action';
  if (upper.includes('CHAT')) return 'chat';
  return 'zoneminder';
}

/**
 * Classifies the latest user message. Falls back to 'zoneminder' on any
 * failure, so a triage outage degrades to exactly the old behaviour (every
 * request reaches the tool loop) rather than to an assistant that can no
 * longer answer questions.
 */
export async function classifyRequest(
  provider: AssistantProvider,
  question: string,
  signal: AbortSignal,
  /** Receives this round for the panel transcript. Without it, triage and
   *  verification were invisible: a turn showed its tool rounds but not the
   *  two calls that decided whether it ran at all, or whether its answer was
   *  accepted. */
  onTrace?: (entry: TraceEntry) => void,
  onStatus?: (status: AssistantStatus) => void,
): Promise<RequestKind> {
  try {
    // `complete`, not `chat`: a classifier handed the tool catalog, the
    // few-shot block and the JSON output contract answers like an assistant
    // instead of returning a verdict. The schema constrains a backend that
    // can enforce it to `{"kind":"..."}`; the parser still accepts the loose
    // one-word reply from a backend that cannot.
    const result = await provider.complete(TRIAGE_PROMPT, question, signal, TRIAGE_SCHEMA as unknown as Record<string, unknown>, onStatus);
    if (result.exchange) {
      onTrace?.({ kind: 'exchange', exchange: { ...result.exchange, backend: `${result.exchange.backend} (triage)` } });
    }
    return parseRequestKind(sanitizeModelText(result.text, 'triage'));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return 'zoneminder';
  }
}

/** The system prompt for a request that must be answered WITHOUT tools.
 *
 *  `base` still leads so the assistant keeps its identity and its read-only
 *  framing; what changes is that there is nothing to call, and it is told so,
 *  rather than being handed nine tools and asked to show restraint. */
export function buildNoToolPrompt(base: string, kind: Exclude<RequestKind, 'zoneminder'>): string {
  const instruction =
    kind === 'action'
      ? [
          'The user has asked you to CHANGE something. You cannot: this assistant can only read data and',
          'navigate. Say plainly that you cannot do it, that this is because an assistant can misread a',
          'request and some of these actions cannot be undone, and tell them where to do it themselves:',
          'monitors and arming on the Monitors screen, run state on the Server screen, deleting and',
          'archiving on the event itself. Do not offer to do it another way.',
        ].join('\n')
      : [
          'This message is not a question about this ZoneMinder installation. Answer it directly and briefly',
          'as yourself. Do not mention tools, do not list what you can do unless asked, and do not invent any',
          'camera, event, or server information.',
          // The scope half of the chat policy lives here rather than in the base
          // prompt: this instruction only ever rides a tool-less turn, so it
          // cannot pull a real ZoneMinder question away from its tool, which is
          // what every base-prompt wording of it did in the eval harness (refs
          // #270). Greetings stay warm; only the task asks get deflected.
          'A greeting, a thank you, or small talk gets a short warm reply, nothing more. Never write code,',
          'poems, or essays, and never take on general knowledge or calculation tasks: for those, and for any',
          'other question that is not about this system, say you are meant for questions about the user\'s',
          'cameras, events, and ZoneMinder system.',
        ].join('\n');

  return `${base}\n\n${instruction}`;
}

export function buildTriageMessages(question: string): AssistantMessage[] {
  return [{ role: 'user', text: question }];
}
