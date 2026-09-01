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
// Cases live in src/ so the on-device eval runner scores the same list (refs #270).
import { TOOL_CASES, CONTRACT_EVAL_OBJECT_LABELS } from '../src/lib/assistant/contract-eval-cases';
import { ANSWER_CASES } from '../src/lib/assistant/answer-eval-cases';

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

const OBJECT_LABELS = CONTRACT_EVAL_OBJECT_LABELS;

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
        const allReplyCalls = r.choices?.[0]?.message?.tool_calls ?? [];
        const call = allReplyCalls[0];
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
        // allCalls cases check every call in the reply; a fault on any one
        // corrupts the answer. Others check the first only.
        const toCheck = c.allCalls ? allReplyCalls : [call];
        let failed = false;
        for (const checked of toCheck) {
          if (checked.function.name !== c.tool) {
            failures.push(`[tool] "${c.q}" called ${checked.function.name}, expected ${c.tool}`);
            failed = true;
            break;
          }
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(checked.function.arguments || '{}');
          } catch {
            failures.push(`[tool] "${c.q}" arguments were not JSON`);
            failed = true;
            break;
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
            failed = true;
            break;
          }
        }
        if (failed) continue;
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
  // "previous month" is legitimately either a rolling month or calendar June
  // (from a July run date); both resolve to a sane window.
  { phrase: 'previous month', ok: (f) => (f.lastUnit === 'month' && f.lastCount === 1) || (f.lastUnit === 'day' && f.lastCount === 30) || (f.fromDate === '2026-06-01' && f.toDate === '2026-06-30') },
  { phrase: 'last 3 hours', ok: (f) => f.lastUnit === 'hour' && f.lastCount === 3 },
  { phrase: 'on sunday', ok: (f) => f.weekday === 'sunday' },
  { phrase: 'yesterday from 4pm to 10pm', ok: (f) => f.daysAgo === 1 && f.fromTime === '16:00' && f.toTime === '22:00' },
  // Calendar spans (refs #265): "summarize april" once queried April 1 only.
  { phrase: 'april', ok: (f) => f.fromDate === '2026-04-01' && f.toDate === '2026-04-30' },
  { phrase: 'february', ok: (f) => f.fromDate === '2026-02-01' && f.toDate === '2026-02-28' },
  { phrase: 'this month', ok: (f) => String(f.fromDate ?? '').endsWith('-01') && f.fromDate === new Date().toISOString().slice(0, 8) + '01' },
  { phrase: 'june 1 to june 15', ok: (f) => f.fromDate === '2026-06-01' && f.toDate === '2026-06-15' },
  // A gratuitous month-end toDate is fine: resolveWindow caps the end at now,
  // so the effective window is identical to the open-ended form.
  { phrase: 'since july 1', ok: (f) => f.fromDate === '2026-07-01' && (f.toDate === undefined || String(f.toDate) >= new Date().toISOString().slice(0, 10)) },
  { phrase: 'letzte Woche', ok: (f) => (f.lastUnit === 'week' && f.lastCount === 1) || (f.lastUnit === 'day' && f.lastCount === 7) },
  { phrase: 'ayer', ok: (f) => f.daysAgo === 1 },
  { phrase: 'hier soir', ok: (f) => f.daysAgo === 1 },
];

async function scoreInterpreter(runs: number) {
  const { WINDOW_SCHEMA, buildInterpreterPrompt } = await import('../src/lib/assistant/window-interpreter');
  // The REAL production prompt: a hand-copied version here drifted behind a
  // schema change and measured a bug the app did not have.
  const system = buildInterpreterPrompt(new Date(), 'America/New_York');
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


/** TIME cases (refs #270): time understanding must be robust to WIDELY VARIED
 *  phrasings, proven by measurement across CLASSES of expression, not by fixing
 *  one phrase at a time. Two model steps own time: EXTRACTION (buildTimeframePrompt
 *  lists the phrases a question names) and INTERPRETATION (buildInterpreterPrompt +
 *  WINDOW_SCHEMA turns each phrase into WindowFields; resolveWindow does arithmetic).
 *  Both prompts are scored here as production sends them.
 *
 *  Cases live in the shared src/lib/assistant/time-eval-cases.ts, the ONE source
 *  of truth the on-device fm-eval runner scores too, so the two can never drift.
 *  A FIXED clock (Sunday 2026-07-19 14:00 America/New_York) makes every predicate
 *  deterministic regardless of the run date, and picks a Sunday so "this weekend"
 *  is unambiguously the current, already-past Sat+Sun rather than a future one. */
const TIME_NOW = new Date('2026-07-19T18:00:00Z');
const TIME_TZ = 'America/New_York';

async function scoreTime(runs: number) {
  const { WINDOW_SCHEMA, buildInterpreterPrompt } = await import('../src/lib/assistant/window-interpreter');
  const { resolveWindow } = await import('../src/lib/assistant/event-range');
  const { buildTimeframePrompt, TIMEFRAME_SCHEMA } = await import('../src/lib/assistant/timeframe-stage');
  const { normalizeWhenPhrase } = await import('../src/lib/assistant/tool-helpers');
  const { TIME_INTERPRET_CASES, TIME_EXTRACT_CASES } = await import('../src/lib/assistant/time-eval-cases');
  const interpretSystem = buildInterpreterPrompt(TIME_NOW, TIME_TZ);
  const extractSystem = buildTimeframePrompt(TIME_NOW, TIME_TZ);

  const byClass = new Map<string, { pass: number; total: number }>();
  const bump = (cls: string, ok: boolean) => {
    const e = byClass.get(cls) ?? { pass: 0, total: 0 };
    e.total++;
    if (ok) e.pass++;
    byClass.set(cls, e);
  };
  const failures: string[] = [];

  for (const c of TIME_INTERPRET_CASES) {
    for (let i = 0; i < runs; i++) {
      try {
        const r = await chat({
          model: MODEL,
          messages: [{ role: 'system', content: interpretSystem }, { role: 'user', content: c.phrase }],
          stream: false,
          max_tokens: 300,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
          response_format: { type: 'json_schema', json_schema: { name: 'window', schema: WINDOW_SCHEMA, strict: true } },
        });
        const text = r.choices?.[0]?.message?.content ?? '';
        const fields = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}');
        const range = resolveWindow(fields, TIME_NOW, TIME_TZ);
        const good = c.ok(fields, range);
        bump(c.cls, good);
        if (!good) failures.push(`[interpret:${c.cls}] "${c.phrase}" -> ${JSON.stringify(fields)}`);
      } catch (e) {
        bump(c.cls, false);
        failures.push(`[interpret:${c.cls}] "${c.phrase}" error: ${(e as Error).message}`);
      }
    }
  }

  for (const c of TIME_EXTRACT_CASES) {
    for (let i = 0; i < runs; i++) {
      try {
        const r = await chat({
          model: MODEL,
          messages: [{ role: 'system', content: extractSystem }, { role: 'user', content: c.question }],
          stream: false,
          max_tokens: 200,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
          response_format: { type: 'json_schema', json_schema: { name: 'timeframe', schema: TIMEFRAME_SCHEMA, strict: true } },
        });
        const text = r.choices?.[0]?.message?.content ?? '';
        const raw = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}');
        const phrasesRaw = Array.isArray(raw.phrases) ? raw.phrases.map((p: unknown) => String(p)) : [];
        // The extractor parrots the prompt's date line; production filters phrases
        // that are not substrings of the question, so score the same way.
        const nq = normalizeWhenPhrase(c.question);
        const phrases = phrasesRaw.filter((p) => nq.includes(normalizeWhenPhrase(p)));
        const joined = phrases.map((p) => normalizeWhenPhrase(p)).join(' | ');
        const good = c.none
          ? phrases.length === 0
          : phrases.length > 0 && (c.expect ?? []).every((e) => joined.includes(e.toLowerCase()));
        bump('extract', good);
        if (!good) failures.push(`[extract] "${c.question}" -> ${JSON.stringify(phrases)}`);
      } catch (e) {
        bump('extract', false);
        failures.push(`[extract] "${c.q}" error: ${(e as Error).message}`);
      }
    }
  }
  return { byClass, failures };
}


/** Triage cases (refs #265): the classifier is scored over a MATRIX of
 *  intents, time spans, and languages, because its historical failures were
 *  all combinations outside its example list ("summarize" + any range). */
const TRIAGE_CASES: Array<{ q: string; kind: 'ZONEMINDER' | 'ACTION' | 'CHAT' }> = [
  // summarize/recap intent across time spans, question and imperative forms
  { q: 'summarize today', kind: 'ZONEMINDER' },
  { q: 'summarize last week', kind: 'ZONEMINDER' },
  { q: 'summarize this month for me please', kind: 'ZONEMINDER' },
  { q: 'give me a recap of the past 3 days', kind: 'ZONEMINDER' },
  { q: 'what happened between june 1 and june 15', kind: 'ZONEMINDER' },
  { q: 'was war letzte Woche bei mir los', kind: 'ZONEMINDER' },
  { q: 'how many people came by today', kind: 'ZONEMINDER' },
  // Both misrouted live on Apple Foundation Models (refs #270): a count or
  // presence question phrased casually, with no camera and no ZoneMinder word
  // in it.
  { q: 'how many cars came today', kind: 'ZONEMINDER' },
  { q: 'did anyone come by', kind: 'ZONEMINDER' },
  // Superlative/statistic questions (refs #270): on Apple Foundation Models
  // "what was my busiest hour" triaged ACTION and the tool-less turn fabricated
  // an hour. The "rank" verb in the ZONEMINDER template covers these.
  { q: 'what was my busiest hour', kind: 'ZONEMINDER' },
  { q: 'which camera was most active', kind: 'ZONEMINDER' },
  { q: 'is the server ok', kind: 'ZONEMINDER' },
  { q: 'show me the front camera', kind: 'ZONEMINDER' },
  // actions
  { q: 'arm the backyard camera', kind: 'ACTION' },
  { q: 'delete all events from last month', kind: 'ACTION' },
  // chat, including summarize-verbs about NON-system things
  { q: 'hello', kind: 'CHAT' },
  { q: 'thanks!', kind: 'CHAT' },
  { q: 'what is the capital of France', kind: 'CHAT' },
  { q: 'summarize the plot of Blade Runner', kind: 'CHAT' },
];

async function scoreTriage(runs: number) {
  const { TRIAGE_PROMPT_FOR_EVAL, TRIAGE_SCHEMA } = await import('../src/lib/assistant/triage');
  let pass = 0;
  let total = 0;
  const failures: string[] = [];
  for (const c of TRIAGE_CASES) {
    for (let i = 0; i < runs; i++) {
      total++;
      try {
        const r = await chat({
          model: MODEL,
          messages: [{ role: 'system', content: TRIAGE_PROMPT_FOR_EVAL }, { role: 'user', content: c.q }],
          stream: false,
          max_tokens: 60,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
          response_format: { type: 'json_schema', json_schema: { name: 'result', schema: TRIAGE_SCHEMA, strict: true } },
        });
        const text = r.choices?.[0]?.message?.content ?? '';
        const kind = JSON.parse(text)?.kind;
        if (kind === c.kind) pass++;
        else failures.push(`[triage] "${c.q}" -> ${kind}, expected ${c.kind}`);
      } catch (e) {
        failures.push(`[triage] "${c.q}" error: ${(e as Error).message}`);
      }
    }
  }
  return { pass, total, failures };
}

/** Parse cases (refs #427, #432): the triage round, handed the roster and
 *  label vocabulary, must fill every slot - cameras as a SET (an umbrella
 *  place means several), subject, and objects mapped by meaning in any
 *  language - and abstain (noMatch) for a place no camera covers, without
 *  disturbing the kind verdict. Scored through the production parser
 *  (parseTriageSlots), so what is measured is what ships. */
const PARSE_LABELS = ['car', 'person', 'truck'];
const R_PLAIN = ['Garage Outdoor', 'Driveway'];
const R_DOOR = ['Garage Outdoor', 'Doorbell'];
const R_HOUSE = ['FrontDoor', 'Front Yard', 'Garage Outdoor'];
interface ParseCase {
  q: string;
  roster: string[];
  kind: string;
  /** Exact expected monitors set, or undefined to skip the check. */
  monitors?: string[];
  /** Accept any non-empty subset of these instead of an exact set. */
  monitorsWithin?: string[];
  noMatch?: boolean;
  subject?: string;
  objects?: string[];
}
const PARSE_CASES: ParseCase[] = [
  // The live failures this architecture exists for:
  { q: 'How may folks came to the front of my house between mon and tue?', roster: R_HOUSE, kind: 'ZONEMINDER', monitorsWithin: ['FrontDoor', 'Front Yard'], subject: 'events', objects: ['person'] },
  { q: 'how many people came to my front door yesterday', roster: R_PLAIN, kind: 'ZONEMINDER', noMatch: true, subject: 'events', objects: ['person'] },
  { q: 'how many people came to my front door yesterday', roster: R_DOOR, kind: 'ZONEMINDER', monitors: ['Doorbell'], subject: 'events', objects: ['person'] },
  { q: 'any cars in the driveway today', roster: R_PLAIN, kind: 'ZONEMINDER', monitors: ['Driveway'], subject: 'events', objects: ['car'] },
  { q: 'was war gestern an der Haust\u00fcr los', roster: R_DOOR, kind: 'ZONEMINDER', monitors: ['Doorbell'], subject: 'events' },
  { q: 'summarize today', roster: R_PLAIN, kind: 'ZONEMINDER', monitors: [], subject: 'events', objects: [] },
  { q: 'is the server ok', roster: R_PLAIN, kind: 'ZONEMINDER', subject: 'server' },
  { q: 'what cameras do I have', roster: R_PLAIN, kind: 'ZONEMINDER', subject: 'monitors' },
  { q: 'hello', roster: R_PLAIN, kind: 'CHAT' },
  { q: 'arm the backyard camera', roster: R_PLAIN, kind: 'ACTION' },
];

function setEq(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && b.every((x) => a.includes(x));
}

async function scoreParse(runs: number) {
  const { buildTriagePromptForEval, buildTriageSchema, parseTriageSlots } = await import('../src/lib/assistant/triage');
  let pass = 0;
  let total = 0;
  const failures: string[] = [];
  for (const c of PARSE_CASES) {
    for (let i = 0; i < runs; i++) {
      total++;
      try {
        const r = await chat({
          model: MODEL,
          messages: [{ role: 'system', content: buildTriagePromptForEval(c.roster, PARSE_LABELS) }, { role: 'user', content: c.q }],
          stream: false,
          max_tokens: 120,
          ...(TEMP === undefined ? {} : { temperature: TEMP }),
          ...REASONING,
          response_format: { type: 'json_schema', json_schema: { name: 'result', schema: buildTriageSchema(c.roster, PARSE_LABELS), strict: true } },
        });
        const text = r.choices?.[0]?.message?.content ?? '';
        const kind = JSON.parse(text)?.kind;
        const slots = parseTriageSlots(text, c.roster, PARSE_LABELS);
        const bad: string[] = [];
        if (kind !== c.kind) bad.push(`kind ${kind}`);
        if (c.monitors !== undefined && !setEq(slots.monitors, c.monitors)) bad.push(`monitors ${JSON.stringify(slots.monitors)}`);
        if (c.monitorsWithin !== undefined) {
          const within = (slots.monitors?.length ?? 0) > 0 && (slots.monitors ?? []).every((m) => c.monitorsWithin!.includes(m));
          if (!within) bad.push(`monitors ${JSON.stringify(slots.monitors)} not within ${JSON.stringify(c.monitorsWithin)}`);
        }
        if (c.noMatch !== undefined && slots.noMatch !== c.noMatch) bad.push(`noMatch ${String(slots.noMatch)}`);
        if (c.subject !== undefined && slots.subject !== c.subject) bad.push(`subject ${String(slots.subject)}`);
        if (c.objects !== undefined && !setEq(slots.objects, c.objects)) bad.push(`objects ${JSON.stringify(slots.objects)}`);
        if (bad.length === 0) pass++;
        else failures.push(`[parse] "${c.q}" [${c.roster.join(', ')}] -> ${bad.join('; ')} (raw ${text})`);
      } catch (e) {
        failures.push(`[parse] "${c.q}" error: ${(e as Error).message}`);
      }
    }
  }
  return { pass, total, failures };
}

const variant = process.argv[2] ?? 'baseline';
const runs = Number(process.argv[3] ?? 2);
const started = Date.now();
if (variant === 'parse') {
  const w = await scoreParse(runs);
  console.log(`\n=== parse via ${MODEL}, temp ${TEMP ?? 'default'} ===`);
  console.log(`parse: ${w.pass}/${w.total}`);
  for (const f of w.failures) console.log(`  ${f}`);
  process.exit(0);
}
if (variant === 'triage') {
  const w = await scoreTriage(runs);
  console.log(`\n=== triage via ${MODEL}, temp ${TEMP ?? 'default'} ===`);
  console.log(`triage: ${w.pass}/${w.total}`);
  for (const f of w.failures) console.log(`  ${f}`);
  process.exit(0);
}
if (variant === 'interpret') {
  const w = await scoreInterpreter(runs);
  console.log(`\n=== interpreter via ${MODEL}, temp ${TEMP ?? 'default'} ===`);
  console.log(`interpret: ${w.pass}/${w.total}`);
  for (const f of w.failures) console.log(`  ${f}`);
  process.exit(0);
}
if (variant === 'time') {
  const w = await scoreTime(runs);
  console.log(`\n=== time via ${MODEL}, temp ${TEMP ?? 'default'}, ${runs} runs/case ===`);
  let pass = 0;
  let total = 0;
  const order = ['relative-day', 'rolling', 'part-of-day', 'weekday', 'weekend', 'ordinal-date', 'month-year', 'clock-range', 'no-time', 'non-english', 'extract'];
  for (const cls of order) {
    const e = w.byClass.get(cls);
    if (!e) continue;
    pass += e.pass;
    total += e.total;
    console.log(`  ${cls.padEnd(13)} ${e.pass}/${e.total}`);
  }
  console.log(`TIME:   ${pass}/${total}`);
  if (w.failures.length) {
    console.log('\nfailures:');
    for (const f of w.failures) console.log(`  ${f}`);
  }
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
