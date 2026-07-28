/**
 * The on-device eval as a background task (refs #270).
 *
 * `runFmTimeEval` is the measurement; this is what makes a run outlive the screen
 * that started it. The eval row used to hold its own progress in component state
 * and abort the run in an unmount effect, so leaving Settings silently threw the
 * measurement away mid-flight. On Android it did worse than that: the abort called
 * the plugin's cancel, which crashed the process on the coroutines mismatch
 * described in `GeminiNanoPlugin.cancelChat`.
 *
 * Progress and result now live in `backgroundTasks`, the same store the model
 * downloads already report through, so a run shows up in the app-level drawer, keeps
 * counting while the user is elsewhere, and is still there when they come back.
 * There is one run per backend at a time, which `findSystemModelEvalTask` enforces
 * for the caller by finding an existing active task.
 */
import { useBackgroundTasks, type BackgroundTask } from '../../stores/backgroundTasks';
import { runFmTimeEval, FM_EVAL_NOW, FM_EVAL_TZ, TIME_EVAL_CASE_COUNT } from './fm-eval';
import { runContractEval, CONTRACT_EVAL_CASE_COUNT } from './contract-eval';
import type { AssistantBackend, AssistantProvider } from './types';
import { log, LogLevel } from '../logger';

/** Marks a task as this backend's eval run, so the row can find its own. A
 *  metadata flag rather than the title, which is localized and so not an identity. */
export function findSystemModelEvalTask(tasks: BackgroundTask[], backend: AssistantBackend): BackgroundTask | undefined {
  // Last, not first: a re-run adds a new task, and the newest is the one whose
  // progress and score the row should be showing.
  return [...tasks].reverse().find((task) => task.metadata.evalBackend === backend);
}

/**
 * Runs the eval against `provider` and reports it as a background task.
 *
 * Never rejects: a failed run is reported through the task, because the caller is a
 * click handler on a screen that may no longer exist by the time it settles, and an
 * unhandled rejection there is invisible to the user either way.
 *
 * The task carries no `cancelFn` on purpose. The run is a handful of model calls
 * that finish on their own, and on Android asking the plugin to cancel is the crash
 * this whole change exists to stop.
 */
export async function runSystemModelEvalTask(
  provider: AssistantProvider,
  backend: AssistantBackend,
  title: string,
  modelLabel: string,
): Promise<void> {
  const tasks = useBackgroundTasks.getState();
  const taskId = tasks.addTask({
    type: 'sync',
    metadata: { title, description: modelLabel, evalBackend: backend },
  });

  try {
    // Not aborted from here: the run owns its lifetime now, so the signal exists
    // only to satisfy the provider contract and is never fired.
    const signal = new AbortController().signal;
    // One progress bar over two stages, so the combined total has to be known
    // before either starts; both stages export their case counts for that.
    const total = TIME_EVAL_CASE_COUNT + CONTRACT_EVAL_CASE_COUNT;
    const tick = (done: number) => {
      useBackgroundTasks.getState().updateProgress(taskId, Math.round((done / total) * 100));
      useBackgroundTasks.getState().updateTaskMetadata(taskId, { evalDone: done, evalTotal: total });
    };

    const time = await runFmTimeEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, signal, (done) => tick(done));
    const contract = await runContractEval(provider, FM_EVAL_NOW, FM_EVAL_TZ, signal, (done) =>
      tick(TIME_EVAL_CASE_COUNT + done),
    );

    const pass = time.total.pass + contract.pass;
    // One line, so the whole report survives in the device log file for pulling;
    // the prefix makes it greppable, and the backend makes two runs comparable.
    log.assistant(
      `SYSTEM_MODEL_EVAL_REPORT ${JSON.stringify({ backend, total: { pass, total: time.total.total + contract.total }, time, contract })}`,
      LogLevel.INFO,
    );
    useBackgroundTasks.getState().updateTaskMetadata(taskId, { evalPass: pass, evalTotal: time.total.total + contract.total });
    useBackgroundTasks.getState().completeTask(taskId);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    log.assistant('System-model eval run failed', LogLevel.ERROR, { backend, error: error.message });
    useBackgroundTasks.getState().failTask(taskId, error);
  }
}
