/**
 * The eval row's run must outlive the screen it was started from (refs #270).
 *
 * The row used to hold progress in component state and abort the run in an unmount
 * effect, so navigating away threw the measurement away mid-flight; on Android the
 * abort also crashed the process. These tests pin the replacement: the run lives in
 * `backgroundTasks`, so unmounting neither stops it nor loses it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AssistantSystemModelEvalRow } from '../AssistantSystemModelEvalRow';
import { useBackgroundTasks } from '../../../stores/backgroundTasks';
import type { AssistantProvider } from '../../../lib/assistant/types';
import type { FmEvalReport } from '../../../lib/assistant/fm-eval';
import { TIME_EVAL_CASE_COUNT } from '../../../lib/assistant/fm-eval';
import { CONTRACT_EVAL_CASE_COUNT } from '../../../lib/assistant/contract-eval';

/** Hand control of the eval to the test: it resolves when the test says so, after
 *  optionally reporting progress. */
let reportProgress: ((done: number, total: number) => void) | undefined;
let settle: ((report: FmEvalReport) => void) | undefined;
let fail: ((error: Error) => void) | undefined;
const runFmTimeEvalMock = vi.fn(
  (_p: unknown, _n: unknown, _tz: unknown, _s: unknown, onProgress?: (done: number, total: number) => void) => {
    reportProgress = onProgress;
    return new Promise<FmEvalReport>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
  },
);

vi.mock('../../../lib/assistant/fm-eval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/assistant/fm-eval')>()),
  runFmTimeEval: (...args: unknown[]) =>
    runFmTimeEvalMock(args[0], args[1], args[2], args[3], args[4] as (done: number, total: number) => void),
}));

// The contract stage runs after the time stage; it is stubbed so these tests stay
// about the row's state surviving a remount, not about either eval's scoring.
const CONTRACT_REPORT = { pass: 12, total: CONTRACT_EVAL_CASE_COUNT, skippedTriaged: 2, failures: [], durationMs: 5 };
vi.mock('../../../lib/assistant/contract-eval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/assistant/contract-eval')>()),
  runContractEval: vi.fn(async () => CONTRACT_REPORT),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: Record<string, unknown>) =>
      d && 'done' in d ? `${k}:${d.done}/${d.total}` : d && 'pass' in d ? `${k}:${d.pass}/${d.total}` : k,
  }),
}));

const REPORT: FmEvalReport = {
  interpret: { pass: 30, total: 36, byClass: {} },
  extract: { pass: 15, total: 16 },
  total: { pass: 45, total: 52 },
  failures: [],
  durationMs: 1234,
};

const provider = {} as AssistantProvider;

function renderRow() {
  return render(
    <AssistantSystemModelEvalRow createProvider={() => provider} backend="gemini-nano" modelLabel="Gemini Nano" />,
  );
}

describe('AssistantSystemModelEvalRow', () => {
  beforeEach(() => {
    useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
    runFmTimeEvalMock.mockClear();
    reportProgress = undefined;
    settle = undefined;
    fail = undefined;
  });

  it('keeps running, and keeps its progress, across an unmount and remount', async () => {
    const first = renderRow();
    act(() => {
      screen.getByTestId('system-model-eval-run').click();
    });
    act(() => reportProgress?.(9, TIME_EVAL_CASE_COUNT));
    expect(screen.getByTestId('system-model-eval-run').textContent).toBe(
      `settings.assistant.system_model_eval_running:9/${TIME_EVAL_CASE_COUNT + CONTRACT_EVAL_CASE_COUNT}`,
    );

    // The user leaves Settings. Nothing may cancel the run.
    first.unmount();
    act(() => reportProgress?.(20, TIME_EVAL_CASE_COUNT));

    // ...and comes back to a row that picks the same run up where it is.
    renderRow();
    expect(screen.getByTestId('system-model-eval-run').textContent).toBe(
      `settings.assistant.system_model_eval_running:20/${TIME_EVAL_CASE_COUNT + CONTRACT_EVAL_CASE_COUNT}`,
    );
    // Still ONE run: the remount must not have started a second.
    expect(runFmTimeEvalMock).toHaveBeenCalledTimes(1);
  });

  it('shows the score of a run that finished while the row was unmounted', async () => {
    const first = renderRow();
    act(() => {
      screen.getByTestId('system-model-eval-run').click();
    });
    first.unmount();

    await act(async () => {
      settle?.(REPORT);
      // Two awaits: the contract stage runs after the time stage settles.
      // One microtask drain per stage that follows the time eval.
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    renderRow();
    // The headline score is both stages together.
    expect(screen.getByTestId('system-model-eval-score').textContent).toBe(
      `settings.assistant.system_model_eval_score:${45 + CONTRACT_REPORT.pass}/${52 + CONTRACT_EVAL_CASE_COUNT}`,
    );
  });

  it('reports a failed run through the task rather than throwing at the click handler', async () => {
    renderRow();
    act(() => {
      screen.getByTestId('system-model-eval-run').click();
    });

    await act(async () => {
      fail?.(new Error('AICore said no'));
      await Promise.resolve();
    });

    expect(screen.getByTestId('system-model-eval-error')).toBeInTheDocument();
    // A failed run must not leave the button stuck disabled.
    expect(screen.getByTestId('system-model-eval-run')).not.toBeDisabled();
  });

  it('carries no cancel affordance, because cancelling the native call crashes on Android', () => {
    renderRow();
    act(() => {
      screen.getByTestId('system-model-eval-run').click();
    });
    const task = useBackgroundTasks.getState().tasks.at(-1);
    expect(task?.metadata.evalBackend).toBe('gemini-nano');
    expect(task?.cancelFn).toBeUndefined();
  });

  it('does not pick up another backend\'s eval run', () => {
    render(
      <AssistantSystemModelEvalRow createProvider={() => provider} backend="apple" modelLabel="Apple Intelligence" />,
    );
    act(() => {
      screen.getByTestId('system-model-eval-run').click();
    });
    act(() => reportProgress?.(5, 52));
    screen.getByTestId('system-model-eval-run'); // apple row is running
    cleanupAndRenderGemini();
    // The Gemini row sees no run of its own, so its button is idle and enabled.
    expect(screen.getByTestId('system-model-eval-run').textContent).toBe('settings.assistant.system_model_eval_run');
    expect(screen.getByTestId('system-model-eval-run')).not.toBeDisabled();
  });
});

/** Replaces the rendered tree with the Gemini row, leaving the store untouched. */
function cleanupAndRenderGemini() {
  document.body.innerHTML = '';
  renderRow();
}
