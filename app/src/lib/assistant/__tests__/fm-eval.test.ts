/**
 * fm-eval runner (refs #270): scoring, failure capture, and progress, driven
 * by a scripted provider so the runner is measured without a live model. The
 * case suite is mocked here so these tests pin the RUNNER's behavior, not the
 * (separately authored) cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AssistantProvider, AssistantTurn, CompletionResult } from '../types';
import { runFmTimeEval, FM_EVAL_NOW, FM_EVAL_TZ } from '../fm-eval';

// Two interpretation cases (one class) and two extraction cases (an `expect`
// and a `none`), enough to exercise both stages and both scoring paths.
vi.mock('../time-eval-cases', () => ({
  TIME_INTERPRET_CASES: [
    { phrase: 'today', cls: 'relative-day', ok: (f: Record<string, unknown>) => f.daysAgo === 0 },
    { phrase: 'yesterday', cls: 'relative-day', ok: (f: Record<string, unknown>) => f.daysAgo === 1 },
  ],
  TIME_EXTRACT_CASES: [
    // Not a 'today' expect: 'today' is the extractor's default fallback, so a
    // 'today' case can never actually fail and would not exercise the failure
    // path.
    { question: 'summarize the past 2 weeks', expect: ['past 2 weeks'] },
    { question: 'what cameras do I have', none: true },
  ],
}));

/** Replays canned JSON keyed by the user text, distinguishing the extractor
 *  call (TIMEFRAME_SCHEMA has a `phrases` property) from the interpreter call
 *  (WINDOW_SCHEMA does not). Counts calls so a test can assert the run really
 *  hit the model rather than a cache. */
class ScriptProvider implements AssistantProvider {
  completeCalls = 0;
  private readonly replies: Record<string, string>;
  constructor(replies: Record<string, string>) {
    this.replies = replies;
  }
  async complete(
    _system: string,
    text: string,
    _signal: AbortSignal,
    jsonSchema?: Record<string, unknown>,
  ): Promise<CompletionResult> {
    this.completeCalls += 1;
    const isExtract = !!(jsonSchema?.properties as Record<string, unknown> | undefined)?.phrases;
    const key = `${isExtract ? 'q' : 'p'}:${text.trim().toLowerCase()}`;
    return { text: this.replies[key] ?? '{}' };
  }
  async chat(): Promise<AssistantTurn> {
    throw new Error('chat is unused by fm-eval');
  }
}

const ALL_CORRECT: Record<string, string> = {
  'p:today': '{"daysAgo":0}',
  'p:yesterday': '{"daysAgo":1}',
  'p:past 2 weeks': '{"lastCount":2,"lastUnit":"week"}',
  'q:summarize the past 2 weeks': '{"phrases":["past 2 weeks"]}',
  'q:what cameras do i have': '{"phrases":[]}',
};

describe('runFmTimeEval', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scores every case, tallies per class, and reports no failures on a perfect run', async () => {
    const provider = new ScriptProvider(ALL_CORRECT);
    const report = await runFmTimeEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, new AbortController().signal);

    expect(report.interpret).toMatchObject({ pass: 2, total: 2 });
    expect(report.interpret.byClass['relative-day']).toEqual({ pass: 2, total: 2 });
    expect(report.extract).toEqual({ pass: 2, total: 2 });
    expect(report.total).toEqual({ pass: 4, total: 4 });
    expect(report.failures).toEqual([]);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    // 2 interpret cases (today, yesterday) + 2 extract questions + the
    // 'past 2 weeks' interpretation the first extraction resolves = 5. The
    // none-case's default 'today' interpretation hits the cache (today was
    // already interpreted), so it adds no call.
    expect(provider.completeCalls).toBe(5);
  });

  it('captures a failed interpretation case with its input, expected class, and got', async () => {
    const provider = new ScriptProvider({ ...ALL_CORRECT, 'p:yesterday': '{"daysAgo":9}' });
    const report = await runFmTimeEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, new AbortController().signal);

    expect(report.total).toEqual({ pass: 3, total: 4 });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      stage: 'interpret',
      cls: 'relative-day',
      input: 'yesterday',
      got: '{"daysAgo":9}',
    });
  });

  it('captures a failed extraction case (wrong phrases)', async () => {
    // Extractor finds no timeframe -> falls to default 'today', which does not
    // contain the expected 'past 2 weeks'.
    const provider = new ScriptProvider({ ...ALL_CORRECT, 'q:summarize the past 2 weeks': '{"phrases":[]}' });
    const report = await runFmTimeEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, new AbortController().signal);

    const extractFailure = report.failures.find((f) => f.stage === 'extract');
    expect(extractFailure).toMatchObject({ input: 'summarize the past 2 weeks', expected: 'past 2 weeks' });
    expect(report.extract.pass).toBe(1);
  });

  it('reports progress after every case, ending at total/total', async () => {
    const provider = new ScriptProvider(ALL_CORRECT);
    const progress: Array<[number, number]> = [];
    await runFmTimeEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, new AbortController().signal, (done, total) =>
      progress.push([done, total]),
    );

    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const provider = new ScriptProvider(ALL_CORRECT);
    const controller = new AbortController();
    controller.abort();
    await expect(runFmTimeEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
