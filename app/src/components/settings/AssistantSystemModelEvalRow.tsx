/**
 * On-device eval trigger for a system-model backend (refs #270).
 *
 * A developer diagnostic, not part of normal setup: it drives the SAME time
 * cases the prompt-eval harness uses through the real production stages against
 * a fresh provider, so a backend the harness cannot reach over HTTP is measured
 * on the same bar as the others. Rendered only when a system-model backend is
 * both selected AND supported, so it never shows on a device that cannot run it.
 *
 * Started life as the Apple-only `AssistantFmEvalRow`. `runFmTimeEval` was
 * already provider-agnostic, so adding Gemini Nano meant parameterizing this row
 * rather than writing a second one; the runner it calls keeps its original name.
 * The reason the two backends can share it unchanged is that the eval exercises
 * `provider.complete`, which neither backend routes through its tool loop.
 *
 * Device e2e is manual-only, so this is user-triggered and never auto-run. The
 * button shows `done/total` progress while running and the total score inline on
 * completion; the full report is written via `log.assistant` at INFO as one
 * `SYSTEM_MODEL_EVAL_REPORT` JSON line so it lands in the pullable device log
 * file. The line carries the backend id, because the whole point of running it on
 * two backends is comparing the two reports afterwards. The run is aborted on
 * unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { RowLabel } from './SettingsLayout';
import type { AssistantBackend, AssistantProvider } from '../../lib/assistant/types';
import { runFmTimeEval, FM_EVAL_NOW, FM_EVAL_TZ } from '../../lib/assistant/fm-eval';
import { log, LogLevel } from '../../lib/logger';

type EvalState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; pass: number; total: number }
  | { phase: 'error' };

interface Props {
  /** A FRESH provider per run, pinned to temperature 0: eval numbers must be
   *  reproducible run to run, while chat keeps the app temperature. A factory
   *  rather than an instance because each provider caches its learned context
   *  window per instance, and a re-run should re-learn it. */
  createProvider: () => AssistantProvider;
  /** Stamped on the report line so two backends' runs can be told apart. */
  backend: AssistantBackend;
  /** The model's brand name, for the hint text. Untranslated, like the chat
   *  header's own backend labels. */
  modelLabel: string;
}

export function AssistantSystemModelEvalRow({ createProvider, backend, modelLabel }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<EvalState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight run if the panel unmounts (the native session is asked
  // to stop via the provider's abort wiring).
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const running = state.phase === 'running';

  const handleRun = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: 'running', done: 0, total: 0 });
    try {
      const report = await runFmTimeEval(createProvider(), FM_EVAL_NOW, FM_EVAL_TZ, controller.signal, (done, total) =>
        setState({ phase: 'running', done, total }),
      );
      // One line, so the whole report survives in the device log file for
      // pulling; the prefix makes it greppable.
      log.assistant(`SYSTEM_MODEL_EVAL_REPORT ${JSON.stringify({ backend, ...report })}`, LogLevel.INFO);
      setState({ phase: 'done', pass: report.total.pass, total: report.total.total });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      log.assistant('System-model eval run failed', LogLevel.ERROR, {
        backend,
        error: error instanceof Error ? error.message : String(error),
      });
      setState({ phase: 'error' });
    } finally {
      abortRef.current = null;
    }
  }, [createProvider, backend]);

  return (
    <div className="px-4 py-3 space-y-2" data-testid="assistant-system-model-eval">
      <RowLabel
        label={t('settings.assistant.system_model_eval')}
        desc={t('settings.assistant.system_model_eval_hint', { model: modelLabel })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={running} onClick={handleRun} data-testid="system-model-eval-run">
          {running
            ? t('settings.assistant.system_model_eval_running', { done: state.done, total: state.total })
            : t('settings.assistant.system_model_eval_run')}
        </Button>
        {state.phase === 'done' && (
          <span className="text-xs text-muted-foreground" data-testid="system-model-eval-score">
            {t('settings.assistant.system_model_eval_score', { pass: state.pass, total: state.total })}
          </span>
        )}
        {state.phase === 'error' && (
          <span className="text-xs text-destructive" data-testid="system-model-eval-error">
            {t('settings.assistant.system_model_eval_failed')}
          </span>
        )}
      </div>
    </div>
  );
}
