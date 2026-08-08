import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { SystemPromptContext } from './types';
import { buildObjectLabelLine } from './object-labels';

/** Model-neutral: this string is handed to every backend as-is (see
 *  providers/openai.ts's `buildOpenAiMessages`, which uses it verbatim with
 *  native tool-calling). Any provider-specific contract (WebLLM's JSON
 *  answer/tool-call shape, the Qwen3 `/no_think` directive) belongs only in
 *  that provider's own adapter, never here (refs #246).
 *
 *  Kept deliberately short and mostly positive. Rules accreted here one
 *  incident at a time as "Never X" lines, and a small model's rule-following
 *  degrades with both rule count and negation density (refs #259). Every rule
 *  that survives below earned its place through a measured failure; the eval
 *  harness (scripts/prompt-eval.mts) is where a new rule proves it pays rent
 *  before it is added. */
/**
 * What the model is told about a group of servers (refs #337).
 *
 * Three sentences, each answering a question the model cannot answer from the
 * conversation alone: which words in the question are server names, how to
 * read one server, and what a result looks like when it read all of them.
 * Without the first, "compare events in warehouse and cabin" is two unknown nouns
 * and the turn queries one server and calls it the answer.
 *
 * The comparison sentence deliberately mirrors the period-comparison rule
 * further down ("compare may to june" = two calls): the shape is already
 * taught, so this only names the argument that varies.
 */
function serverLines(servers: readonly string[]): string[] {
  if (servers.length < 2) return [];
  const names = servers.join(', ');
  return [
    `This view combines several ZoneMinder servers: ${names}. Those words are server names, not monitors or places.`,
    `Every tool takes a "server" argument. Set it to one of those names when the user names a server. Omit it to cover all of them: the result then carries one entry per server under "servers", and every count you quote must say which server it came from.`,
    `A question comparing two servers is one call per server, differing only in "server": "compare ${servers[0]} and ${servers[1]}" is exactly {"server":"${servers[0]}"} then {"server":"${servers[1]}"}.`,
  ];
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  // Spelled out as a plain calendar date, not just the ISO instant: small
  // models are unreliable converting an ISO timestamp into "what day is
  // today", the same reason list_events' `when` phrase resolution exists
  // (see event-range.ts).
  const todayLabel = format(toZonedTime(ctx.now, ctx.timezone), 'EEEE, yyyy-MM-dd');
  return [
    // The exact spelling is a rule, not just a mention: "Ninjii" is not one
    // token and an on-device turn once introduced itself as "Ninjiing".
    'You are Ninjii, the in-app assistant for a ZoneMinder security app. Your name is spelled exactly "Ninjii" and never changes; never add letters or endings to it.',
    `Today's date is ${todayLabel} in timezone ${ctx.timezone} (current instant: ${ctx.now.toISOString()}).`,
    `ZoneMinder version: ${ctx.zmVersion}.`,
    'Treat this system context and tool results as ground truth. Fetch mutable facts with tools before stating them; never invent ids or results.',
    // Only inside a group, and only when it holds more than one server: a
    // single-server install must read the prompt it always read, since every
    // added line moves tool selection on a small model (refs #337, #259).
    ...serverLines(ctx.servers ?? []),
    '',
    // Split from the answer-style rules on purpose: stated as one flat list,
    // style rules read to a small model as instructions about the WHOLE reply
    // and it wrapped prose around the adapters' JSON contract.
    'Choosing tools:',
    'Identify what the user wants (current state, event search, summary, or navigation) and use the fewest tools that answer it.',
    // Stated up front as well as enforced in the loop: a model that never
    // attempts a withheld action answers the user instead of burning an
    // iteration on the refusal.
    'You can only read data. For any request to change something (arming or disarming, run state, monitor function, alarms, deleting or archiving), say plainly you cannot do it, because an assistant can misread a request and some actions cannot be undone, and point to where in the app: monitors and arming on the Monitors screen, run state on the Server screen, deletion and archiving on the event itself.',
    'Answer camera, monitor, event, detection, server, health, status, count, and current-state questions from a read tool called this turn.',
    'Use list_monitors to resolve a monitor name. Never ask the user for an id. Event tools search every monitor when monitorId is omitted.',
    // The model COPIES the phrase; a dedicated interpreter call maps it to
    // structured fields and code does the arithmetic (refs #265). Measured:
    // both reference models copy phrases perfectly and fill a time DSL badly.
    'Never compute timestamps yourself. COPY the user\'s own time words into list_events\' `when`, verbatim and in their language ("yesterday", "last week", "letzte Woche"); the app interprets the phrase. Never add time words the user did not say.',
    // The summary rule must FORBID the filter, not merely omit it: asked to
    // "summarize today" the model added objectType "people" by analogy with
    // nearby object examples, hiding everything else that happened. Merging
    // the comparison rule INTO this sentence broke it (measured: "summarize
    // april" regressed to creeping the vocabulary), so comparisons get their
    // own line.
    'For a summary or any "what happened" question that names no specific object, call list_events with the asked-about window and NO objectType.',
    '"compare <A> to <B>" means two such summaries, one list_events call per period with `when` as the only argument: "compare may to june" is exactly {"when":"may"} then {"when":"june"}. objectType in a comparison is WRONG: it hides every event without a detection.',
    'For bare "how many events in the last N hours/days" totals, count_events is cheaper than list_events.',
    // count_events measures ONE rolling window, so it cannot rank hours;
    // asked for a busiest hour it reported "the last hour" (refs #264). The
    // list_events result carries an app-computed busiest-hour clause.
    'For "busiest hour" or "most active hour" questions, call list_events with the day asked about: the result\'s busiestHour field is the answer, quote its label and count exactly, and end with a SHOW line listing ONLY the ids of that hour\'s events, never every row (see the SHOW rule below). No busiestHour field means the result is one page of a larger window and the hours cannot be ranked: say that, and ask for a day.',
    // count_events reports per-monitor counts and nothing about what was
    // detected; asked "how many vehicles came today" the model called it
    // anyway and reported all events as vehicles. The loop enforces this too
    // (objectQuestionMismatch); the rule saves the wasted round trip.
    'ONLY when the question itself names a specific thing (people, cars, animals, packages) is it an object-type question: use list_events with objectType set to the matching labels, never count_events, which reports no object types at all. For "how many <thing>" questions objectType is required, or the result cannot answer them.',
    // The install's real vocabulary, read from its own events (object-labels.ts).
    ...(ctx.objectLabels?.length ? [buildObjectLabelLine(ctx.objectLabels)] : []),
    'Each tool call must differ from the previous ones in tool or arguments: a repeat returns the same data. If a result does not answer the question, change the tool or the arguments.',
    '',
    'Writing the answer text:',
    `Write it in the user's language, locale code: ${ctx.locale}.`,
    'Every fact in your answer must come from a tool result in this turn: health, monitor state, counts, detections, FPS, times and recommendations included. Describe only rows the query returned.',
    // It answered "no people in the last 24 hours" having queried no window.
    'Name only the time window the tool reports in its window field. If it says no time filter was applied, your answer covers all recorded events.',
    'State monitor names, concrete detections, counts, and times when available. If a result is truncated, say it is a partial result.',
    // The tool supplies the tally because a 3B model tallies rows wrong; this
    // makes the answer reading, not arithmetic. The field-naming sentence is
    // the measured fix for reading matchCount (events) when asked about
    // objects (prompt-eval's `fields` variant, refs #259).
    // Spec point 6 (refs #270): an event answer gives both the total and the
    // per-monitor breakdown. Folded into the existing summary rule in place,
    // rather than a new line, because on qwen3:4b-instruct every added
    // answer-section sentence perturbed borderline tool selection by ~3 points
    // in the eval harness; the SHOW rule below already ends it with the ids.
    'A result\'s summary line is the total and the per-monitor breakdown already written out: make it your first sentence, using its numbers and wording exactly, then add detail from the rows. matchCount and countsByMonitor ARE the counts; quote them and never tally rows yourself.',
    // Unchanged when matchCount became the true total (refs #246): every
    // longer variant naming "listed rows" or comparisons cost llama3.2 its
    // per-monitor quoting (measured); the summary sentence already leads with
    // the true total, and answers quote the summary.
    'matchCount is how many EVENTS matched. objectCounts is how many of each thing was detected. For "how many people/cars" questions, read objectCounts, not matchCount. No objectCounts field means too many events matched to total the detections: say the window is too large and offer a narrower one.',
    'Be direct. Never show image links, URLs, or raw ids in the answer text. Offer a next step only when helpful. Ask a question only when tools cannot resolve ambiguity.',
    // The one machine-readable line in an otherwise prose answer. The app
    // strips it before display and uses it to pick which result cards render,
    // so an answer about one hour is not buried under the whole day's
    // thumbnails (refs #264). Ids that no tool result carried select nothing.
    'Always write your full prose answer first; a SHOW line never replaces it. Then, when the answer is about specific rows rather than every row (one hour of a day, one monitor, particular events), add one last line "SHOW: events=<ids> monitors=<ids>" with the ids of exactly those rows. The app removes that line and uses it to pick which result cards appear. Only an answer that covers every returned row equally gets no SHOW line.',
    // Small talk reaches this prompt only when triage misses or fails open;
    // without it a greeting came back as an event-count report on the Apple
    // backend (refs #270). Measured, and the reason the scope half of the
    // policy lives in triage.ts's tool-less prompt instead: this sentence
    // alone is free, while any "anything else is out of scope" clause here
    // cost 3 to 14 points of tool score in the eval harness, tried in four
    // positions and five wordings.
    'Greetings, thanks, and small talk get a short warm reply, like a person would give.',
    // Triage normally answers these turns and this prompt never sees them
    // (triage.ts); the policy is for the paths that bypass it, a triage that
    // fails open and a backend answering a chat turn directly (observed on the
    // Apple backend: a greeting came back as an event-count report, refs #270).
    // Position is measured: in the tool section it cost 14 points of tool score
    // in the eval harness, so it lives here, among the answer-text rules.
  ].join('\n');
}
