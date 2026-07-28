/**
 * On-device eval trigger for a system-model backend (refs #270).
 *
 * A developer diagnostic, not part of normal setup: it drives the SAME time cases
 * the prompt-eval harness uses through the real production stages against a fresh
 * provider, so a backend the harness cannot reach over HTTP is measured on the same
 * bar as the others. Rendered only when a system-model backend is both selected AND
 * supported, so it never shows on a device that cannot run it.
 *
 * Started life as the Apple-only `AssistantFmEvalRow`. `runFmTimeEval` was already
 * provider-agnostic, so adding Gemini Nano meant parameterizing this row rather than
 * writing a second one.
 *
 * This component holds NO run state. Progress and the score live in
 * `backgroundTasks` (see `system-model-eval.ts`), which is what makes a run survive
 * this screen unmounting: leaving Settings mid-run used to abort the measurement,
 * and on Android the abort crashed the app outright. The row is now a button and a
 * readout over a task it looks up, so a remount re-reads exactly what is still
 * running. Device e2e is manual-only, so this stays user-triggered.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { RowLabel } from './SettingsLayout';
import { useBackgroundTasks } from '../../stores/backgroundTasks';
import { findSystemModelEvalTask, runSystemModelEvalTask } from '../../lib/assistant/system-model-eval';
import type { AssistantBackend, AssistantProvider } from '../../lib/assistant/types';

interface Props {
  /** A FRESH provider per run, pinned to temperature 0: eval numbers must be
   *  reproducible run to run, while chat keeps the app temperature. A factory
   *  rather than an instance because each provider caches its learned context
   *  window per instance, and a re-run should re-learn it. */
  createProvider: () => AssistantProvider;
  /** Which backend this row measures; also how it finds its own task. */
  backend: AssistantBackend;
  /** The model's brand name, for the hint. Untranslated, like the chat header's
   *  own backend labels. */
  modelLabel: string;
}

export function AssistantSystemModelEvalRow({ createProvider, backend, modelLabel }: Props) {
  const { t } = useTranslation();
  // Subscribes to `tasks` only; the find returns the task object itself, whose
  // identity changes exactly when the store replaces it (Stores contract).
  const task = useBackgroundTasks((state) => findSystemModelEvalTask(state.tasks, backend));
  const running = task?.status === 'pending' || task?.status === 'in_progress';

  const handleRun = useCallback(() => {
    // Deliberately not awaited: the run outlives this component, and the task
    // carries its outcome. `runSystemModelEvalTask` never rejects.
    void runSystemModelEvalTask(createProvider(), backend, t('settings.assistant.system_model_eval'), modelLabel);
  }, [createProvider, backend, modelLabel, t]);

  const done = typeof task?.metadata.evalDone === 'number' ? task.metadata.evalDone : 0;
  const total = typeof task?.metadata.evalTotal === 'number' ? task.metadata.evalTotal : 0;

  return (
    <div className="px-4 py-3 space-y-2" data-testid="assistant-system-model-eval">
      <RowLabel
        label={t('settings.assistant.system_model_eval')}
        desc={t('settings.assistant.system_model_eval_hint', { model: modelLabel })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={running} onClick={handleRun} data-testid="system-model-eval-run">
          {running
            ? t('settings.assistant.system_model_eval_running', { done, total })
            : t('settings.assistant.system_model_eval_run')}
        </Button>
        {task?.status === 'completed' && typeof task.metadata.evalPass === 'number' && (
          <span className="text-xs text-muted-foreground" data-testid="system-model-eval-score">
            {t('settings.assistant.system_model_eval_score', { pass: task.metadata.evalPass, total: task.metadata.evalTotal })}
          </span>
        )}
        {task?.status === 'failed' && (
          <span className="text-xs text-destructive" data-testid="system-model-eval-error">
            {t('settings.assistant.system_model_eval_failed')}
          </span>
        )}
      </div>
    </div>
  );
}
