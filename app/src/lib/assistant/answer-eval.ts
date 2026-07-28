/**
 * On-device answer-quality eval (refs #270).
 *
 * The third and most important stage. The time eval asks whether a backend can read
 * "last tuesday night"; the contract eval asks whether it fetches the right thing.
 * This asks the question the user actually cares about: having fetched the data, does
 * it tell the truth about it.
 *
 * That matters most for the system models, because every failure this stage catches
 * has been seen from one of them and none were caught by the other two stages: counts
 * invented instead of read ("15 events today, 10 yesterday" over a result carrying
 * five), the data denied while rows sat in the result, monitor names invented, and
 * the raw tool JSON handed back as the answer. `grounding.ts` catches two of those at
 * runtime; nothing measured how often they happen.
 *
 * The turn is staged so the model has nothing to do but write prose: the question, its
 * own tool call, and the tool's result are already in the history, exactly as
 * `scoreAnswers` stages it in the HTTP harness.
 */
import { buildSystemPrompt } from './system-prompt';
import { TOOLS } from './tools';
import { ANSWER_CASES } from './answer-eval-cases';
import { CONTRACT_EVAL_OBJECT_LABELS } from './contract-eval-cases';
import type { AssistantProvider } from './types';
import { log, LogLevel } from '../logger';

/** How many cases this eval scores, for a caller sizing one bar over all stages. */
export const ANSWER_EVAL_CASE_COUNT = ANSWER_CASES.length;

export interface AnswerEvalFailure {
  q: string;
  /** The named checks that did not hold ('no-denial', 'not-json', ...). */
  failed: string[];
  /** The start of the answer, so a reader can see what it actually said. */
  answer: string;
}

export interface AnswerEvalReport {
  pass: number;
  total: number;
  /** Every check that failed anywhere, counted. Which KIND of untruth a backend
   *  tells is more useful than how many cases it lost: 'not-json' failing twice
   *  is a different bug from 'total' failing twice. */
  failedChecks: Record<string, number>;
  failures: AnswerEvalFailure[];
  durationMs: number;
}

/**
 * Runs every answer case and returns the tally. Never throws for a single case: a
 * backend that rejects one is scored as failing it and the run continues.
 *
 * No `runTool` here, unlike the contract eval. The tool result is already in the
 * history, so a backend with a native tool loop has nothing left to call and writes
 * the answer, which is the only thing being scored.
 */
export async function runAnswerEval(
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<AnswerEvalReport> {
  const startedAt = Date.now();
  const system = buildSystemPrompt({
    now,
    timezone,
    zmVersion: '1.39.1',
    locale: 'en-US',
    objectLabels: CONTRACT_EVAL_OBJECT_LABELS,
  } as never);

  const failures: AnswerEvalFailure[] = [];
  const failedChecks: Record<string, number> = {};
  let pass = 0;
  let done = 0;

  for (const c of ANSWER_CASES) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const turn = await provider.chat(
        [
          { role: 'user', text: c.q },
          // The model's own call, then what it returned. Shaped the way the agent
          // re-serializes history so every backend replays it as it would its own.
          { role: 'assistant', text: undefined, toolCalls: [{ id: 'c1', name: 'list_events', input: { daysAgo: 0 } }] },
          { role: 'tool', toolResults: [{ callId: 'c1', output: c.result }] },
        ],
        TOOLS,
        system,
        signal,
      );
      const answer = (turn.text ?? '').trim();
      if (!answer) {
        failedChecks.empty = (failedChecks.empty ?? 0) + 1;
        failures.push({ q: c.q, failed: ['empty'], answer: '' });
      } else {
        const failed = c.checks.filter((chk) => !chk.ok(answer)).map((chk) => chk.name);
        for (const name of failed) failedChecks[name] = (failedChecks[name] ?? 0) + 1;
        if (failed.length === 0) pass += 1;
        else failures.push({ q: c.q, failed, answer: answer.slice(0, 160) });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      failedChecks.error = (failedChecks.error ?? 0) + 1;
      failures.push({ q: c.q, failed: ['error'], answer: error instanceof Error ? error.message : String(error) });
    }
    onProgress?.(++done, ANSWER_CASES.length);
  }

  const report: AnswerEvalReport = {
    pass,
    total: ANSWER_CASES.length,
    failedChecks,
    failures,
    durationMs: Date.now() - startedAt,
  };
  log.assistant('Answer eval finished', LogLevel.INFO, { pass: report.pass, total: report.total });
  return report;
}
