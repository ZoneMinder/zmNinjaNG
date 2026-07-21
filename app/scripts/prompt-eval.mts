/**
 * Prompt evaluation harness.
 *
 * Imports the REAL system prompt and the REAL tool schemas, so a variant is
 * scored under the conditions it will actually run in. Tool results are canned
 * (taken verbatim from live transcripts) rather than fetched, so a run is
 * reproducible and does not depend on what the cameras happen to have recorded.
 *
 * Two stages, because the prompt has two jobs and they fail differently:
 *   1. TOOL   - given a question, is the right tool called with usable arguments?
 *   2. ANSWER - given a tool result, is the answer grounded in it?
 *
 * Usage (from app/):
 *   TEMP=0 npx tsx scripts/prompt-eval.mts baseline 6
 *   MODEL=gemma4:latest OLLAMA=http://host:11434/v1 npx tsx scripts/prompt-eval.mts baseline 6
 *   TEMP=0 CONSTRAIN=1 npx tsx scripts/prompt-eval.mts webllm 3   # envelope-schema-constrained proxy,
 *     approximating the on-device XGrammar constraint (refs #259) via Ollama json_schema
 *
 * Needs a reachable Ollama server, so it is NOT part of `npm test`: it is the
 * thing to run when changing the system prompt, the tool schemas, or the
 * recommended model, none of which unit tests can score.
 *
 * What it already settled: two prompt rewrites measured within noise of the
 * current wording, while pinning the sampling temperature moved the score from
 * 57/66 to 66/66. Measure before rewriting prose.
 */
import { buildSystemPrompt } from '../src/lib/assistant/system-prompt';
import { TOOLS } from '../src/lib/assistant/tools';
import { toOpenAiTools } from '../src/lib/assistant/providers/openai';
import { coerceLabelList, stripOmittedArgs } from '../src/lib/assistant/tool-helpers';
import { buildWebLlmMessages, parseWebLlmTurn } from '../src/lib/assistant/providers/webllm';

const LONG = 'Never count rows yourself. When a result carries a summary line, it is the counts already written out: START your answer with it, using its numbers and wording exactly. Add detail from the rows after it. When a result carries matchCount or countsByMonitor, those numbers ARE the counts: quote them exactly and never add up the rows to get your own.';

const BASE = process.env.OLLAMA ?? 'http://localhost:11434/v1';
const MODEL = process.env.MODEL ?? 'llama3.2:latest';
// Uncontrolled sampling made two runs of the SAME prompt differ by 7 points,
// which is larger than any difference between prompts. Pin it.
const TEMP = process.env.TEMP === undefined ? undefined : Number(process.env.TEMP);
/** NOTHINK=1 appends Qwen3's `/no_think` soft switch to the system prompt,
 *  for measuring what disabling the reasoning block costs in accuracy and
 *  buys in latency (refs #259). No effect on non-Qwen3 models.
 *
 *  Measured caveat: on Ollama 0.32 the soft switch only hides the think TAG;
 *  the model still reasons (the /v1 reply carries a `reasoning` field and the
 *  latency is unchanged). REASONING=none sends OpenAI's `reasoning_effort`,
 *  which Ollama maps to think-off for real: 0.4s vs 3.7s on the same
 *  question. Non-thinking models ignore the field. */
const NOTHINK = process.env.NOTHINK ? '\n\n/no_think' : '';
const REASONING = process.env.REASONING ? { reasoning_effort: process.env.REASONING } : {};

const OBJECT_LABELS = ['car', 'carrot', 'person', 'truck'];

// Verbatim from a live transcript.
const TODAY_RESULT =
  '{"summary":"5 events between 2026-07-20 00:00:00 and 2026-07-20 09:31:51. By monitor: FrontDoor 2, Front Yard 2, Garage Outdoor 1. Detected: person 4, car 1.","window":{"from":"2026-07-20 00:00:00","to":"2026-07-20 09:31:51"},"matchCount":5,"countsByMonitor":{"FrontDoor":2,"Front Yard":2,"Garage Outdoor":1},"objectCounts":{"person":4,"car":1},"events":[{"id":"253363","monitor":"FrontDoor","start":"2026-07-20 08:36:33","durationSec":30.02,"objects":["person"]},{"id":"253362","monitor":"Front Yard","start":"2026-07-20 08:36:21","durationSec":30.06,"objects":["person"]},{"id":"253361","monitor":"Front Yard","start":"2026-07-20 08:35:45","durationSec":30.03,"objects":["person"]},{"id":"253360","monitor":"FrontDoor","start":"2026-07-20 08:35:19","durationSec":30,"objects":["person"]},{"id":"253359","monitor":"Garage Outdoor","start":"2026-07-20 08:20:59","durationSec":30,"objects":["car"]}]}';

// TODAY_RESULT with the busiestHour/countsByHour fields list_events now
// reports (refs #264), and one row moved out of the busy hour so the SHOW
// directive has a real subset to select: four rows in 08:00, one in 09:00.
const BUSIEST_RESULT = TODAY_RESULT.replace(
  '"matchCount":5,',
  '"matchCount":5,"busiestHour":{"label":"2026-07-20 08:00:00","count":4},"countsByHour":{"2026-07-20 08:00:00":4,"2026-07-20 09:00:00":1},',
).replace('"start":"2026-07-20 08:20:59"', '"start":"2026-07-20 09:31:00"');

const EMPTY_RESULT =
  '{"summary":"No events between 2026-07-20 00:00:00 and 2026-07-20 09:31:51.","window":{"from":"2026-07-20 00:00:00","to":"2026-07-20 09:31:51"},"matchCount":0,"countsByMonitor":{},"objectCounts":{},"events":[]}';

interface ToolCase {
  q: string;
  /** Tool that answers it. `null` means no tool should be called at all. */
  tool: string | null;
  /** Argument check. Absent means any arguments pass. */
  args?: (a: Record<string, unknown>) => boolean;
  /** Handled by triage before the prompt sees it; reported, not scored. */
  triaged?: boolean;
}

const TOOL_CASES: ToolCase[] = [
  { q: 'summarize today', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('today') && a.objectType === undefined },
  { q: 'what happened yesterday', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('yesterday') && a.objectType === undefined },
  // The phrasings the old English phrase grammar could not read (refs #265):
  // the model interprets them into structured fields, in any language.
  { q: 'summarize last week', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('last week') },
  { q: 'what happened in the past 2 weeks', tool: 'list_events', args: (a) => /past 2 weeks|2 weeks/.test(String(a.when).toLowerCase()) },
  { q: 'was war gestern bei mir los', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('gestern') },
  { q: 'how many people came today', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('today') && String(a.objectType).includes('person') },
  // Triage answers these with NO tools in production (see triage.ts), so the
  // prompt is not what decides them. Kept visible, scored separately.
  {
    q: 'how many vehicles came yesterday',
    tool: 'list_events',
    args: (a) => {
      const t = (a.objectType ?? []) as string[];
      return String(a.when).toLowerCase().includes('yesterday') && t.includes('car') && t.includes('truck');
    },
  },
  // count_events measures ONE rolling window and cannot rank hours; the
  // list_events result carries the app-computed busiest-hour clause (refs #264).
  { q: 'what was my busiest hour yesterday', tool: 'list_events', args: (a) => String(a.when).toLowerCase().includes('yesterday') },
  { q: 'is the server ok', tool: 'get_server_health' },
  { q: 'what cameras do I have', tool: 'list_monitors' },
  { q: 'how many events in the last 24 hours', tool: 'count_events', args: (a) => (a.lastUnit === 'hour' && a.lastCount === 24) || (a.lastUnit === 'day' && a.lastCount === 1) },
  { q: 'what tags are available', tool: 'list_tags' },
  { q: 'hello', tool: null, triaged: true },
  { q: 'what is the capital of France', tool: null, triaged: true },
];

interface AnswerCase {
  q: string;
  result: string;
  /** Every one must hold for the answer to score. */
  checks: { name: string; ok: (a: string) => boolean }[];
}

const lower = (s: string) => s.toLowerCase();
const deniesData = (a: string) =>
  /\b(none|no events|nothing (was )?found|not found|no matches)\b/i.test(a);

const ANSWER_CASES: AnswerCase[] = [
  {
    q: 'summarize today',
    result: TODAY_RESULT,
    checks: [
      { name: 'total', ok: (a) => /\b5\b/.test(a) },
      { name: 'per-monitor', ok: (a) => /\b2\b/.test(a) && /\b1\b/.test(a) },
      { name: 'names-real', ok: (a) => !/EXAMPLE_|Backyard|Front Gate|Driveway/i.test(a) },
      { name: 'no-denial', ok: (a) => !deniesData(a) },
      { name: 'objects', ok: (a) => lower(a).includes('person') || lower(a).includes('people') },
      { name: 'not-json', ok: (a) => !a.trim().startsWith('{') },
    ],
  },
  {
    q: 'how many people came today',
    result: TODAY_RESULT,
    checks: [
      { name: 'person-count', ok: (a) => /\b4\b/.test(a) },
      { name: 'no-denial', ok: (a) => !deniesData(a) },
      { name: 'not-json', ok: (a) => !a.trim().startsWith('{') },
    ],
  },
  {
    q: 'what was my busiest hour today',
    result: BUSIEST_RESULT,
    checks: [
      // The hour itself, however phrased: card narrowing is id-driven (SHOW),
      // so exact label quoting stopped being load-bearing.
      { name: 'names-hour', ok: (a) => /8:00|08:00|8 ?am/i.test(a) },
      { name: 'count', ok: (a) => /\b4\b/.test(a) },
      { name: 'no-denial', ok: (a) => !deniesData(a) },
      { name: 'not-json', ok: (a) => !a.trim().startsWith('{') },
      // The SHOW directive (refs #264): the busy hour's ids selected, the
      // 09:00 stray excluded, so only the answer's cards render.
      { name: 'show-subset', ok: (a) => /SHOW: ?events=/.test(a) && a.includes('253363') && !/SHOW:[^\n]*253359/.test(a) },
    ],
  },
  {
    q: 'summarize today',
    result: EMPTY_RESULT,
    checks: [
      // The honest empty answer: it MUST say nothing was found.
      { name: 'says-empty', ok: (a) => deniesData(a) },
      { name: 'no-invented-rows', ok: (a) => !/FrontDoor|Garage|person|car\b/i.test(a) },
    ],
  },
];

async function chat(body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function systemPrompt(variant: string): string {
  const base = buildSystemPrompt({
    now: new Date('2026-07-20T13:31:48.799Z'),
    timezone: 'America/New_York',
    zmVersion: '1.39.1',
    locale: 'en-US',
    objectLabels: OBJECT_LABELS,
  } as never);
  if (variant === 'baseline') return base + NOTHINK;
  const override = VARIANTS[variant];
  if (!override) throw new Error(`unknown variant: ${variant}`);
  return override(base) + NOTHINK;
}

/** Variants are transformations of the real prompt, so they can never drift
 *  from it structurally: each rewrites specific rule lines and leaves the rest. */
const VARIANTS: Record<string, (base: string) => string> = {
  // One 348-character, four-sentence rule broken into short single-idea lines,
  // and moved to the FRONT of the answer section. Same content.
  split: (base) => {
    const short = [
      'Copy the result\'s summary line as your first sentence, word for word. It is already correct.',
      'Then add detail from the rows.',
      'The numbers in the result are the counts. Read them; do not add up rows yourself.',
    ].join('\n');
    return base.replace(LONG, '').replace(
      'Writing the answer text:',
      `Writing the answer text:\n${short}`,
    ).replace(/\n\n+/g, '\n\n');
  },

  // As `split`, plus the field that answers an object-type question named
  // outright. The observed fabrication is reading matchCount (5 events) when
  // asked how many people (objectCounts.person, 4).
  fields: (base) => {
    const short = [
      'Copy the result\'s summary line as your first sentence, word for word. It is already correct.',
      'Then add detail from the rows.',
      'The numbers in the result are the counts. Read them; do not add up rows yourself.',
      'matchCount is how many EVENTS matched. objectCounts is how many of each thing was detected. For "how many people/cars", read objectCounts, not matchCount.',
    ].join('\n');
    return base.replace(LONG, '').replace(
      'Writing the answer text:',
      `Writing the answer text:\n${short}`,
    ).replace(/\n\n+/g, '\n\n');
  },

  // `fields`, with the remaining answer-section prohibitions restated as
  // positive instructions. Tests whether negation density itself costs
  // anything, holding content constant.
  positive: (base) => {
    let out = VARIANTS.fields(base);
    out = out.replace(
      'Describe only rows the query returned. Never state server health, monitor state, event counts, detections, FPS, times, or recommendations unless a tool returned that fact in this turn.',
      'Every fact in your answer must come from a tool result in this turn: health, monitor state, counts, detections, FPS and times all included.',
    );
    out = out.replace(
      'Never name a time period you did not query. Use the window the tool reports: if it says no time filter was applied, your answer covers all recorded events, not today or the last 24 hours.',
      'Name the period the tool reports in its window field. If it says no time filter was applied, say your answer covers all recorded events.',
    );
    out = out.replace(
      'Be direct. Never show image links, URLs, or raw ids.',
      'Be direct. Write monitor names and times as words, leaving out image links, URLs and raw ids.',
    );
    return out;
  },
};

const LONG_RULE_SENTINEL = 1;

async function scoreTools(system: string, runs: number) {
  const tools = toOpenAiTools(TOOLS);
  let pass = 0;
  let total = 0;
  let triagedPass = 0;
  let triagedTotal = 0;
  const failures: string[] = [];
  for (const c of TOOL_CASES) {
    for (let i = 0; i < runs; i++) {
      if (c.triaged) triagedTotal++;
      else total++;
      try {
        const r = await chat({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: c.q },
          ],
          tools,
          tool_choice: 'auto',
          stream: false,
          max_tokens: 4096,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
        });
        const call = r.choices?.[0]?.message?.tool_calls?.[0];
        if (c.tool === null) {
          // Counted against the triaged tally, not the scored one: incrementing
          // `pass` here made the score exceed its own total (30/24).
          if (!call) {
            if (c.triaged) triagedPass++;
            else pass++;
          } else {
            failures.push(`[tool] "${c.q}" called ${call.function.name}, expected none`);
          }
          continue;
        }
        if (!call) {
          failures.push(`[tool] "${c.q}" called nothing, expected ${c.tool}`);
          continue;
        }
        if (call.function.name !== c.tool) {
          failures.push(`[tool] "${c.q}" called ${call.function.name}, expected ${c.tool}`);
          continue;
        }
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          failures.push(`[tool] "${c.q}" arguments were not JSON`);
          continue;
        }
        // The SAME repairs the app applies before a tool runs, so a fault it
        // already fixes is not counted against the prompt. A stringified array
        // argument is llama3.2's known habit and coerceLabelList handles it.
        args = stripOmittedArgs(args);
        if (args.objectType !== undefined) args.objectType = coerceLabelList(args.objectType);
        // Same repair the executor applies (refs #265): numeric window fields
        // arrive as strings from llama3.2 and Number() them before use.
        for (const key of ['lastCount', 'daysAgo']) {
          if (typeof args[key] === 'string' && args[key] !== '' && !Number.isNaN(Number(args[key]))) args[key] = Number(args[key]);
        }
        if (c.args && !c.args(args)) {
          failures.push(`[tool] "${c.q}" args ${JSON.stringify(args)}`);
          continue;
        }
        if (c.triaged) triagedPass++; else pass++;
      } catch (e) {
        failures.push(`[tool] "${c.q}" error: ${(e as Error).message}`);
      }
    }
  }
  return { pass, total, triagedPass, triagedTotal, failures };
}

async function scoreAnswers(system: string, runs: number) {
  const tools = toOpenAiTools(TOOLS);
  let pass = 0;
  let total = 0;
  const failures: string[] = [];
  for (const c of ANSWER_CASES) {
    for (let i = 0; i < runs; i++) {
      total++;
      try {
        const r = await chat({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: c.q },
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'list_events', arguments: '{"daysAgo":0}' } },
              ],
            },
            { role: 'tool', tool_call_id: 'c1', content: c.result },
          ],
          tools,
          tool_choice: 'auto',
          stream: false,
          max_tokens: 4096,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
        });
        const text = r.choices?.[0]?.message?.content ?? '';
        if (!text) {
          failures.push(`[answer] "${c.q}" produced no text`);
          continue;
        }
        const failed = c.checks.filter((chk) => !chk.ok(text));
        if (failed.length === 0) pass++;
        else failures.push(`[answer] "${c.q}" failed ${failed.map((f) => f.name).join(',')}: ${text.slice(0, 90)}`);
      } catch (e) {
        failures.push(`[answer] "${c.q}" error: ${(e as Error).message}`);
      }
    }
  }
  return { pass, total, failures };
}

/**
 * The WebLLM contract, scored through Ollama.
 *
 * WebLLM needs WebGPU and cannot run here, so this is a PROXY, not the real
 * thing: it sends the messages `buildWebLlmMessages` really builds (tools
 * described in prose, one JSON object back, no native tool calling) and parses
 * them with the real `parseWebLlmTurn`. Same contract and same base model
 * family; a different quantization and runtime. Good enough to tell whether the
 * temperature finding carries to the prompt-only path, not a substitute for a
 * manual browser run.
 */
async function scoreWebLlmContract(runs: number) {
  const system = systemPrompt('baseline');
  let pass = 0;
  let total = 0;
  const failures: string[] = [];
  for (const c of TOOL_CASES) {
    if (c.triaged) continue;
    for (let i = 0; i < runs; i++) {
      total++;
      // With NOTHINK set, a Qwen3 model id makes buildWebLlmMessages append
      // /no_think itself, exercising the adapter's real directive path.
      const messages = buildWebLlmMessages(
        system,
        [{ role: 'user', text: c.q }],
        TOOLS,
        process.env.NOTHINK ? 'Qwen3-8B-q4f16_1-MLC' : 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      );
      // CONSTRAIN=1 approximates the on-device XGrammar envelope constraint
      // (webllm.ts's ENVELOPE_SCHEMA) with Ollama's json_schema grammar.
      const envelope = {
        anyOf: [
          { type: 'object', properties: { tool: { type: 'string' }, input: { type: 'object' } }, required: ['tool', 'input'], additionalProperties: false },
          { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
        ],
      };
      try {
        const r = await chat({
          model: MODEL,
          messages,
          stream: false,
          max_tokens: 4096,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
          ...(process.env.CONSTRAIN
            ? { response_format: { type: 'json_schema', json_schema: { name: 'envelope', schema: envelope, strict: true } } }
            : {}),
        });
        const turn = parseWebLlmTurn(r.choices?.[0]?.message?.content ?? '');
        const call = turn.toolCalls[0];
        if (!call) {
          failures.push(`[webllm] "${c.q}" no tool call, expected ${c.tool}`);
          continue;
        }
        if (call.name !== c.tool) {
          failures.push(`[webllm] "${c.q}" called ${call.name}, expected ${c.tool}`);
          continue;
        }
        let args = stripOmittedArgs(call.input as Record<string, unknown>);
        if (args.objectType !== undefined) args.objectType = coerceLabelList(args.objectType);
        if (c.args && !c.args(args)) {
          failures.push(`[webllm] "${c.q}" args ${JSON.stringify(args)}`);
          continue;
        }
        pass++;
      } catch (e) {
        failures.push(`[webllm] "${c.q}" error: ${(e as Error).message}`);
      }
    }
  }
  return { pass, total, failures };
}


/** Interpreter cases (refs #265): phrase in, structured fields out, measured
 *  against the live model under the same constrained schema production uses.
 *  The variants here are exactly what the deleted phrase grammar could not
 *  read and what the direct-DSL contract got wrong. */
const INTERPRET_CASES: Array<{ phrase: string; ok: (f: Record<string, unknown>) => boolean }> = [
  { phrase: 'today', ok: (f) => f.daysAgo === 0 },
  { phrase: 'yesterday', ok: (f) => f.daysAgo === 1 },
  { phrase: '2 days ago', ok: (f) => f.daysAgo === 2 },
  { phrase: 'last week', ok: (f) => (f.lastUnit === 'week' && f.lastCount === 1) || (f.lastUnit === 'day' && f.lastCount === 7) },
  { phrase: 'past 2 weeks', ok: (f) => (f.lastUnit === 'week' && f.lastCount === 2) || (f.lastUnit === 'day' && f.lastCount === 14) },
  { phrase: 'previous month', ok: (f) => (f.lastUnit === 'month' && f.lastCount === 1) || (f.lastUnit === 'day' && f.lastCount === 30) },
  { phrase: 'last 3 hours', ok: (f) => f.lastUnit === 'hour' && f.lastCount === 3 },
  { phrase: 'on sunday', ok: (f) => f.weekday === 'sunday' },
  { phrase: 'yesterday from 4pm to 10pm', ok: (f) => f.daysAgo === 1 && f.fromTime === '16:00' && f.toTime === '22:00' },
  { phrase: 'letzte Woche', ok: (f) => (f.lastUnit === 'week' && f.lastCount === 1) || (f.lastUnit === 'day' && f.lastCount === 7) },
  { phrase: 'ayer', ok: (f) => f.daysAgo === 1 },
  { phrase: 'hier soir', ok: (f) => f.daysAgo === 1 },
];

async function scoreInterpreter(runs: number) {
  const { WINDOW_SCHEMA } = await import('../src/lib/assistant/window-interpreter');
  const { format } = await import('date-fns');
  const today = format(new Date(), 'EEEE, yyyy-MM-dd');
  const system = [
    'You convert a human time phrase into a JSON time window. Reply with ONLY one JSON object.',
    `Today is ${today} (timezone America/New_York).`,
    'Fields (use the fewest that express the phrase):',
    '- lastCount + lastUnit: a rolling span ending now. "past 2 weeks" -> {"lastCount":2,"lastUnit":"week"}.',
    '- daysAgo: one calendar day. "today" -> {"daysAgo":0}. "yesterday" -> {"daysAgo":1}.',
    '- weekday: the most recent such day. "on sunday" -> {"weekday":"sunday"}.',
    '- date: an explicit calendar date. "July 15" -> {"date":"2026-07-15"} (use the year that makes it most recent, never future).',
    '- fromTime/toTime: 24h "HH:MM", narrowing a single day. "yesterday from 4pm to 10pm" -> {"daysAgo":1,"fromTime":"16:00","toTime":"22:00"}.',
    '- none: true when the phrase asks for no time limit. "all time" -> {"none":true}.',
    'The phrase may be in any language: "letzte Woche" -> {"lastCount":1,"lastUnit":"week"}; "ayer" -> {"daysAgo":1}.',
    'A calendar day word is never a rolling span: "today" is daysAgo 0, NOT lastCount 1 day.',
  ].join('\n');
  let pass = 0;
  let total = 0;
  const failures: string[] = [];
  for (const c of INTERPRET_CASES) {
    for (let i = 0; i < runs; i++) {
      total++;
      try {
        const r = await chat({
          model: MODEL,
          messages: [{ role: 'system', content: system }, { role: 'user', content: c.phrase }],
          stream: false,
          max_tokens: 300,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
          response_format: { type: 'json_schema', json_schema: { name: 'window', schema: WINDOW_SCHEMA, strict: true } },
        });
        const text = r.choices?.[0]?.message?.content ?? '';
        const fields = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}');
        if (c.ok(fields)) pass++;
        else failures.push(`[interpret] "${c.phrase}" -> ${JSON.stringify(fields)}`);
      } catch (e) {
        failures.push(`[interpret] "${c.phrase}" error: ${(e as Error).message}`);
      }
    }
  }
  return { pass, total, failures };
}

const variant = process.argv[2] ?? 'baseline';
const runs = Number(process.argv[3] ?? 2);
const started = Date.now();
if (variant === 'interpret') {
  const w = await scoreInterpreter(runs);
  console.log(`\n=== interpreter via ${MODEL}, temp ${TEMP ?? 'default'} ===`);
  console.log(`interpret: ${w.pass}/${w.total}`);
  for (const f of w.failures) console.log(`  ${f}`);
  process.exit(0);
}
if (variant === 'webllm') {
  const w = await scoreWebLlmContract(runs);
  console.log(`\n=== webllm contract via ${MODEL}, temp ${TEMP ?? 'default'} (PROXY: no WebGPU here) ===`);
  console.log(`tool: ${w.pass}/${w.total}`);
  for (const f of w.failures) console.log(`  ${f}`);
  process.exit(0);
}
const system = systemPrompt(variant);
const t = await scoreTools(system, runs);
const a = await scoreAnswers(system, runs);
const seconds = ((Date.now() - started) / 1000).toFixed(0);

console.log(`\n=== ${variant} (${MODEL}, ${runs} runs/case) ===`);
console.log(`prompt: ${system.length} chars, temp: ${TEMP ?? 'default'}`);
console.log(`tool:   ${t.pass}/${t.total}`);
console.log(`triage: ${t.triagedPass}/${t.triagedTotal} (not scored: triage handles these with no tools)`);
console.log(`answer: ${a.pass}/${a.total}`);
console.log(`TOTAL:  ${t.pass + a.pass}/${t.total + a.total}  (${seconds}s)`);
if ([...t.failures, ...a.failures].length) {
  console.log('\nfailures:');
  for (const f of [...t.failures, ...a.failures]) console.log(`  ${f}`);
}
