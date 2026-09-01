/**
 * Decides what KIND of request this is before any tool is offered (refs #246).
 *
 * The agent loop hands the model every tool on every turn, so "hello" was
 * answered with `list_monitors({})` and "arm the backyard camera"
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
import { log, LogLevel } from '../logger';
import { isAbortError } from '../is-abort-error';
import { buildContextualQuestion, type ParseContext } from './parse-context';

export { buildContextualQuestion, prevTurnFromThread, type ParseContext, type PrevTurn } from './parse-context';

export type RequestKind = 'zoneminder' | 'chat' | 'action';

/** What the events/monitors/server question is about; `other` falls back to
 *  the free tool loop (refs #432). */
export type QuerySubject = 'events' | 'monitors' | 'server' | 'groups' | 'other';

const QUERY_SUBJECTS: readonly QuerySubject[] = ['events', 'monitors', 'server', 'groups', 'other'];

/** What one triage round decided (refs #432, #438): the request kind and
 *  the ROUTING slots, each validated here and absent rather than guessed.
 *  Camera coverage is deliberately not part of this round any more: judged
 *  inside this consolidated prompt it failed live and every rewording
 *  rotated the failures; the dedicated coverage call (monitor-stage.ts)
 *  measures 8/8 on the same cases. One question per judgment. */
export interface TriageVerdict {
  kind: RequestKind;
  /** The latest message continues the earlier exchange (refs #446): ONE
   *  explicit judgment, decoded before every other field, and the only
   *  thing that lets any context reach the coverage and time calls. */
  continues?: boolean;
  subject?: QuerySubject;
  /** Recorded labels the question asks about ("folks" -> person). */
  objects?: string[];
  /** Time phrases copied verbatim from the question (refs #434), for the
   *  timeframe stage to union with its own scan; provenance and
   *  interpretation stay there. Absent without a roster. */
  when?: string[];
}


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
 *  the shape of the rule rather than enumerate its instances.
 *
 *  The count and presence shapes ("how many <thing> came <any period>", "did
 *  anyone come by") are there for the Apple Foundation Models backend (refs
 *  #270), where "how many people came today" and "how many cars came today"
 *  classified as CHAT or ACTION. On that backend the tool-less turn answers
 *  with an answer-only schema and no fail-open recovery, so a misroute is a
 *  dead end ("No information available") and triage accuracy is the ceiling.
 *  The "rank" verb covers superlative and statistic questions the same way
 *  (refs #270): "what was my busiest hour", "which camera was most active",
 *  "quietest day this week" are ZONEMINDER events questions, and on Apple FM
 *  "what was my busiest hour" triaged ACTION and the tool-less turn then
 *  fabricated an hour. Added as a verb (the "what is wanted done" dimension),
 *  not as example instances: adding both a verb and a superlative example
 *  over-broadened and pulled "summarize the plot of Blade Runner" into
 *  ZONEMINDER 3/3 on llama3.2 (qwen3:4b-instruct and llama3.2 both already
 *  route the superlatives to ZONEMINDER; the verb is for the weaker backend).
 *
 *  They are taught IN the template list rather than as an appended block of
 *  "message -> VERDICT" examples, which is what was tried first and measured
 *  worse on every wording (qwen3:4b-instruct, temp 0, schema-constrained, 18
 *  cases): the arrow block scored 10/18 against 16/18 for the prompt without
 *  it, and a bare extra rule sentence scored 11/18. The failure mode is not
 *  misclassification but stalling: asked a question the prompt quotes back at
 *  it, the model spends its whole token budget on whitespace before the
 *  constrained JSON. Editing the existing list instead costs no length and
 *  measured 34/36. Add nothing here without re-running `prompt-eval.mts
 *  triage`. */
const triagePromptLines = (servers: readonly string[], monitors: readonly string[], labels: readonly string[]): string[] => [
  'You classify one user message for a ZoneMinder security-camera app. Reply with EXACTLY one word.',
  '',
  'Decide by WHAT THE USER WANTS DONE and WHAT IT CONCERNS, whatever language the message is in:',
  'classify its meaning, not its words. Asking what happened at their place or home means this',
  'camera system. A time span in the message (today, last week, this month, an hour, any custom',
  'range) NEVER changes the category.',
  '',
  'ZONEMINDER - any request to summarize, recap, count, rank, list, look up, check, or view THIS system\'s',
  '  cameras, monitors, events, detections, recordings, activity, or server health, or to be taken to a',
  '  screen in the app. Questions and commands alike, in any language: "summarize <any period>",',
  '  "what happened <any period>", "how many <thing> came <any period>", "did anyone come by",',
  '  "show me <camera>". A message that mixes a greeting or small talk with such a question is',
  '  still ZONEMINDER: any part asking about their place decides. A status question about a period',
  '  with no other topic ("how is today looking", "how are things", "anything happening?") is',
  '  ZONEMINDER too: in this app it asks what the cameras saw.',
  // Refs #337, observed live: "compare warehouse and cabin" classified CHAT, and
  // the tool-less turn answered it with a greeting. The names of the user's
  // own servers are the one piece of context that decides such a message, and
  // nothing else in this prompt can supply it. Written INTO the ZONEMINDER
  // list, not appended as a block: the comment above records that an appended
  // block costs accuracy while editing this list costs none.
  ...(servers.length >= 2
    ? [`  A message naming one of this view's servers (${servers.join(', ')}) is about THIS system.`]
    : []),
  'ACTION - a request to CHANGE something here: arm or disarm a monitor, enable or disable a camera,',
  '  trigger or cancel an alarm, change the run state or a monitor function, delete or archive an event.',
  'CHAT - anything NOT about this system: greetings, thanks, small talk, questions about you, general',
  '  knowledge, or summarizing something that is not this system\'s activity.',
  '',
  // The routing parse block (refs #432, #438), appended only when the
  // caller has a roster (a configured install), so the roster-less prompt
  // stays byte-identical to what the eval harness scores. Subject, objects,
  // and the verbatim time phrases are all enums or copies; the place and
  // coverage judgment lives in its own focused call (monitor-stage.ts),
  // where the same model measures 8/8 on the cases this consolidated
  // prompt failed.
  ...(monitors.length > 0
    ? [
        ...(labels.length > 0 ? [`Detected object labels on this installation: ${labels.join(', ')}.`] : []),
        '"continues" comes first: true ONLY when the LATEST message cannot be understood without the',
        'earlier context (a bare "yes", "do it", "what about ..."). A message that is a complete question',
        'by itself - naming its own place, time, or subject - is false, even on the same topic; and it is',
        'always false when no earlier question is shown.',
        'Also fill these fields about the message, judged by meaning in any language:',
        '"subject": what the message asks about. events - what happened, who or what came by, was seen,',
        "detected, or counted. monitors - the camera list or a camera's state. server - health or whether",
        'the system is up. groups - monitor groups. other - anything else.',
        ...(labels.length > 0
          ? [
              '"objects": every listed label the message asks about, judged by meaning ("folks" or "Leute" mean',
              'person, "vehicles" means car and truck); [] when it asks about no particular thing - a summary,',
              'recap, "how busy", or "what happened" question names none.',
            ]
          : []),
        '',
        `Reply with "kind" (ZONEMINDER, ACTION, or CHAT), "subject"${labels.length > 0 ? ', and "objects"' : ''}.`,
      ]
    : ['Reply with one word: ZONEMINDER, ACTION, or CHAT.']),
];

/** The classifier's prompt for a turn covering `servers`, extended with the
 *  parse block when `monitors` has a roster (refs #427, #432). With neither,
 *  it is identical to the string this file has always sent. */
function buildTriagePrompt(servers: readonly string[], monitors: readonly string[] = [], labels: readonly string[] = []): string {
  return triagePromptLines(servers, monitors, labels).join('\n');
}

const TRIAGE_PROMPT = buildTriagePrompt([]);

/** The verdict as a schema, for a backend that can constrain generation to it
 *  (see `AssistantProvider.complete`). Constrained, the reply is exactly
 *  `{"kind":"CHAT"}` and the substring fallback below never guesses. */
export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: { kind: { type: 'string', enum: ['ZONEMINDER', 'ACTION', 'CHAT'] } },
  required: ['kind'],
  additionalProperties: false,
} as const;

/** TRIAGE_SCHEMA, plus the parse slots when a roster exists (refs #427,
 *  #432): array enums of the REAL monitor names and recorded labels, so a
 *  constrained backend physically cannot reply with a camera or label that
 *  does not exist. With no roster it is exactly TRIAGE_SCHEMA. */
export function buildTriageSchema(monitors: readonly string[], labels: readonly string[] = []): Record<string, unknown> {
  if (monitors.length === 0) return TRIAGE_SCHEMA as unknown as Record<string, unknown>;
  return {
    type: 'object',
    properties: {
      // Decoded first (refs #446): relatedness is one explicit judgment.
      continues: { type: 'boolean' },
      kind: { type: 'string', enum: ['ZONEMINDER', 'ACTION', 'CHAT'] },
      subject: { type: 'string', enum: [...QUERY_SUBJECTS] },
      ...(labels.length > 0 ? { objects: { type: 'array', items: { type: 'string', enum: [...labels] } } } : {}),
    },
    required: ['continues', 'kind', 'subject', ...(labels.length > 0 ? ['objects'] : [])],
    additionalProperties: false,
  };
}

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

/** The roster-extended prompt for the eval harness (prompt-eval.mts parse
 *  stage), so the parse is scored on exactly what production sends
 *  (refs #427, #432). Not used elsewhere. */
export function buildTriagePromptForEval(monitors: readonly string[], labels: readonly string[] = []): string {
  return buildTriagePrompt([], monitors, labels);
}

export function parseRequestKind(reply: string): RequestKind {
  try {
    const kind = (JSON.parse(reply) as { kind?: unknown }).kind;
    if (typeof kind === 'string') return parseKindWord(kind);
  } catch {
    // Not the constrained shape; fall through to the loose match.
  }
  return parseKindWord(reply);
}

/** The parse slots out of the same reply (refs #427, #430, #432), every one
 *  derived in code and validated against the enums the schema promised. No
 *  loose fallback on purpose: a wrong kind degrades to a recoverable
 *  misroute, but a wrong slot becomes a system line or a planned tool call
 *  asserting the wrong thing. Exported for the eval harness (prompt-eval.mts
 *  parse stage), which must score exactly what production derives. */
export function parseTriageSlots(
  reply: string,
  monitors: readonly string[],
  labels: readonly string[] = [],
): Omit<TriageVerdict, 'kind'> {
  if (monitors.length === 0) return {};
  let raw: { continues?: unknown; subject?: unknown; objects?: unknown };
  try {
    raw = JSON.parse(reply) as typeof raw;
  } catch {
    return {};
  }
  const slots: Omit<TriageVerdict, 'kind'> = {};
  if (typeof raw.continues === 'boolean') slots.continues = raw.continues;
  if (typeof raw.subject === 'string' && (QUERY_SUBJECTS as readonly string[]).includes(raw.subject)) {
    slots.subject = raw.subject as QuerySubject;
  }
  if (labels.length > 0 && Array.isArray(raw.objects)) {
    const objects = raw.objects.filter((o): o is string => typeof o === 'string' && labels.includes(o));
    // Selecting the ENTIRE vocabulary is the objectType-creep signature
    // (observed live on "how busy...", refs #436), and as a filter it
    // silently EXCLUDES events with no detection at all: derive no filter.
    slots.objects = labels.length > 1 && objects.length === labels.length ? [] : objects;
  }
  return slots;
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
  /** Servers this view combines (refs #337). Their names go into the prompt,
   *  because a message that names one is about this system and nothing else
   *  here can tell the classifier that. */
  servers: readonly string[] = [],
  /** Monitor names to parse place references against (refs #427, #432).
   *  Empty skips the whole parse block: prompt and schema stay exactly what
   *  this file always sent. */
  monitors: readonly string[] = [],
  /** Recorded object labels, so the parse can map "folks"/"Leute" onto the
   *  install's own vocabulary (refs #432). Only used with a roster. */
  objectLabels: readonly string[] = [],
  /** The previous exchange, so follow-ups classify with their topic
   *  (refs #440). */
  context?: ParseContext,
): Promise<TriageVerdict> {
  try {
    // `complete`, not `chat`: a classifier handed the tool catalog, the
    // few-shot block and the JSON output contract answers like an assistant
    // instead of returning a verdict. The schema constrains a backend that
    // can enforce it to `{"kind":"..."}`; the parser still accepts the loose
    // one-word reply from a backend that cannot.
    const result = await provider.complete(buildTriagePrompt(servers, monitors, objectLabels), buildContextualQuestion(question, context), signal, buildTriageSchema(monitors, objectLabels), onStatus);
    if (result.exchange) {
      onTrace?.({ kind: 'exchange', exchange: { ...result.exchange, backend: `${result.exchange.backend} (triage)` } });
    }
    const text = sanitizeModelText(result.text, 'triage');
    const slots = parseTriageSlots(text, monitors, objectLabels);
    let kind = parseRequestKind(text);
    // A CHAT verdict whose own slots say the message is about the system is
    // self-contradictory (refs #440), and routing a real question to the
    // tool-less lane is the worse failure: it fabricates. Code flips it.
    if (kind === 'chat' && slots.subject !== undefined && slots.subject !== 'other') {
      log.assistant('CHAT verdict contradicts its own subject; routing to the data lane', LogLevel.WARN, {
        subject: slots.subject,
      });
      kind = 'zoneminder';
    }
    return { kind, ...slots };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { kind: 'zoneminder' };
  }
}

/** The tool-less policy text `buildNoToolPrompt` appends, exported so a backend
 *  that rebuilds the prompt for itself can carry it over verbatim instead of
 *  restating it. The apple provider composes its own instructions from the
 *  caller's prompt (see `buildAppleInstructions`) and would otherwise drop this
 *  block, which is the entire routing decision for a chat or action turn. */
export const NO_TOOL_INSTRUCTIONS: Record<Exclude<RequestKind, 'zoneminder'>, string> = {
  action: [
    'The user has asked you to CHANGE something. You cannot: this assistant can only read data.',
    'Say plainly that you cannot do it, that this is because an assistant can misread a',
    'request and some of these actions cannot be undone, and tell them where to do it themselves:',
    'monitors and arming on the Monitors screen, run state on the Server screen, deleting and',
    'archiving on the event itself. Do not offer to do it another way.',
    // Observed on Apple Foundation Models (refs #270): an action turn
    // refused the change and then invented the system's condition,
    // "Server is healthy. FPS: 1.0. Health: 100%". No tool ran on this
    // turn, so every such number is fabricated.
    'Never state any system fact, count, status, or health figure: no tool has run on this turn, so',
    'you have retrieved nothing and have nothing to report.',
  ].join('\n'),
  chat: [
    // Softer than the old hard refusal (refs #270, pipeline-v2): a chat turn
    // gets a brief helpful general answer, not a deflection to "I only do
    // ZoneMinder". The single identity mention keeps the assistant grounded
    // without listing tools. This instruction only ever rides a tool-less
    // turn, so it cannot pull a real ZoneMinder question away from its tool,
    // which is what every base-prompt wording of it did in the eval harness.
    'This message is not about this ZoneMinder installation. Give a brief, helpful general answer as',
    'yourself, and mention once that you are an AI assistant for the user\'s ZoneMinder system. A greeting,',
    'a thank you, or small talk gets one short warm reply. Never call a tool, and never invent any camera,',
    'event, or server information.',
    // Observed live (refs #440): a misrouted follow-up got "the system is
    // running smoothly... no recent events detected" - every clause invented,
    // no tool had run. Same wording that measurably stopped this on the
    // action lane (refs #270).
    'Never say you will check, look up, or fetch anything, and never ask whether to: you cannot on this',
    'turn - and never state any camera, event, or server condition, count, or status: no tool has run, so',
    'you have retrieved nothing and have nothing to report.',
  ].join('\n'),
};

/** The system prompt for a request that must be answered WITHOUT tools.
 *
 *  `base` still leads so the assistant keeps its identity and its read-only
 *  framing; what changes is that there is nothing to call, and it is told so,
 *  rather than being handed nine tools and asked to show restraint. */
export function buildNoToolPrompt(base: string, kind: Exclude<RequestKind, 'zoneminder'>): string {
  return `${base}\n\n${NO_TOOL_INSTRUCTIONS[kind]}`;
}

export function buildTriageMessages(question: string): AssistantMessage[] {
  return [{ role: 'user', text: question }];
}
