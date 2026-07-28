/**
 * On-device time-understanding eval runner (refs #270).
 *
 * The prompt-eval harness (`scripts/prompt-eval.mts`) measures the time
 * extraction + interpretation prompts against a live OpenAI-compatible server,
 * but it cannot drive Apple Foundation Models: that backend has no HTTP API,
 * only the native `AppleIntelligence` bridge, so FM was the one production
 * backend the harness could never score (see `project_apple_fm_backend`). This
 * runs the SAME cases (`time-eval-cases.ts`) through the SAME production stages
 * (`extractTimeframes`, `interpretWhen`) against any `AssistantProvider`,
 * on-device included, so FM is finally measured on the same bar as the others.
 *
 * Device e2e is manual-only, so this is user-triggered from settings, never
 * auto-run. The full report is logged as one `FM_EVAL_REPORT` line so it lands
 * in the pullable device log file.
 */
import { interpretWhen, resetWindowInterpreterCacheForTests } from './window-interpreter';
import { extractTimeframes } from './timeframe-stage';
import { resolveWindow } from './event-range';
import { normalizeWhenPhrase } from './tool-helpers';
import type { AssistantProvider } from './types';
import { TIME_INTERPRET_CASES, TIME_EXTRACT_CASES } from './time-eval-cases';

/** The fixed clock every case predicate is written against: Sunday
 *  2026-07-19 14:00 America/New_York (same instant prompt-eval.mts pins). A
 *  fixed clock makes every date/weekend/"the 21st" predicate deterministic
 *  regardless of when the eval is run; a Sunday makes "this weekend" the
 *  already-past Sat+Sun rather than a future one. The runner takes `now`/
 *  `timezone` as parameters so it stays unit-testable with a mock clock; the
 *  settings trigger passes these. */
export const FM_EVAL_NOW = new Date('2026-07-19T18:00:00Z');
export const FM_EVAL_TZ = 'America/New_York';

/** How many cases this eval scores. Exported so a caller running it alongside the
 *  contract eval can size one progress bar over both (see `system-model-eval.ts`). */
export const TIME_EVAL_CASE_COUNT = TIME_INTERPRET_CASES.length + TIME_EXTRACT_CASES.length;

/** One class's running tally. */
export interface FmEvalTally {
  pass: number;
  total: number;
}

/** A case that did not meet its predicate, kept compact for the log line. */
export interface FmEvalFailure {
  /** 'interpret' | 'extract', so a reader can tell which stage failed. */
  stage: 'interpret' | 'extract';
  /** The case's class label ('relative-day', 'rolling', 'extract'...). */
  cls: string;
  /** The phrase or question fed in. */
  input: string;
  /** A short human summary of what the case expected. */
  expected: string;
  /** What the stage actually produced (fields JSON, phrase list, or error). */
  got: string;
}

export interface FmEvalReport {
  /** Interpretation cases scored, per class and overall. */
  interpret: FmEvalTally & { byClass: Record<string, FmEvalTally> };
  /** Extraction cases scored. */
  extract: FmEvalTally;
  /** Combined pass/total across both stages. */
  total: FmEvalTally;
  failures: FmEvalFailure[];
  durationMs: number;
}

function bump(tally: Record<string, FmEvalTally>, cls: string, ok: boolean): void {
  const entry = (tally[cls] ??= { pass: 0, total: 0 });
  entry.total += 1;
  if (ok) entry.pass += 1;
}

/**
 * Runs every interpretation case through `interpretWhen` and every extraction
 * case through `extractTimeframes`, scoring each with the case's own predicate,
 * and returns the tallies plus the failures.
 *
 * The window-interpreter's per-day cache is cleared once at the start so a
 * re-run actually re-queries the model instead of replaying the previous run's
 * answers (the whole point of pressing the button again is a fresh
 * measurement). Progress is reported after each case so the UI can show
 * `done/total`. Aborts cleanly: the abort propagates from the provider calls,
 * matching the rest of the assistant path.
 */
export async function runFmTimeEval(
  provider: AssistantProvider,
  now: Date,
  timezone: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<FmEvalReport> {
  // Fresh measurement per run: the same phrase on the same day would otherwise
  // hit the cache and never reach the model on a second press.
  resetWindowInterpreterCacheForTests();

  const startedAt = Date.now();
  const total = TIME_INTERPRET_CASES.length + TIME_EXTRACT_CASES.length;
  let done = 0;
  const failures: FmEvalFailure[] = [];
  const byClass: Record<string, FmEvalTally> = {};
  const extract: FmEvalTally = { pass: 0, total: 0 };

  for (const c of TIME_INTERPRET_CASES) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const fields = await interpretWhen(c.phrase, provider, now, timezone, signal);
    if ('error' in fields) {
      bump(byClass, c.cls, false);
      failures.push({ stage: 'interpret', cls: c.cls, input: c.phrase, expected: c.cls, got: fields.error });
    } else {
      const range = resolveWindow(fields, now, timezone);
      const ok = c.ok(fields as Record<string, unknown>, range);
      bump(byClass, c.cls, ok);
      if (!ok) failures.push({ stage: 'interpret', cls: c.cls, input: c.phrase, expected: c.cls, got: JSON.stringify(fields) });
    }
    onProgress?.(++done, total);
  }

  for (const c of TIME_EXTRACT_CASES) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const cls = c.cls ?? 'extract';
    const result = await extractTimeframes(c.question, provider, now, timezone, signal);
    const phrases = result.phrases.map((p) => normalizeWhenPhrase(p));
    // A none-case is correct when the extractor found no stated timeframe and
    // fell to the default 'today' (extractTimeframes never returns an empty
    // phrase list except when it abstains). The `expect` cases require each
    // expected phrase to appear as a normalized substring of some returned
    // phrase, exactly as prompt-eval scores them.
    const ok = c.none
      ? phrases.length === 1 && phrases[0] === 'today'
      : !result.abstained && (c.expect ?? []).every((e) => phrases.some((p) => p.includes(normalizeWhenPhrase(e))));
    extract.total += 1;
    if (ok) extract.pass += 1;
    else {
      failures.push({
        stage: 'extract',
        cls,
        input: c.question,
        expected: c.none ? 'no timeframe (default today)' : (c.expect ?? []).join(', '),
        got: result.abstained ? 'abstained' : JSON.stringify(result.phrases),
      });
    }
    onProgress?.(++done, total);
  }

  const interpretTotals = Object.values(byClass).reduce(
    (acc, e) => ({ pass: acc.pass + e.pass, total: acc.total + e.total }),
    { pass: 0, total: 0 },
  );

  return {
    interpret: { ...interpretTotals, byClass },
    extract,
    total: { pass: interpretTotals.pass + extract.pass, total: interpretTotals.total + extract.total },
    failures,
    durationMs: Date.now() - startedAt,
  };
}
