/**
 * On-device eval trigger for the Apple Foundation Models backend (refs #270).
 *
 * A developer diagnostic, not part of normal setup: it drives the SAME time
 * cases the prompt-eval harness uses through the real production stages against
 * a fresh `AppleIntelligenceProvider`, so FM is measured on-device (the harness
 * cannot reach it over HTTP). Rendered only when the apple backend is selected
 * AND supported, so it never shows on a device that cannot run it.
 *
 * Device e2e is manual-only, so this is user-triggered and never auto-run. The
 * button shows `done/total` progress while running and the total score inline
 * on completion; the full report is written via `log.assistant` at INFO as one
 * `FM_EVAL_REPORT` JSON line so it lands in the pullable device log file. The
 * run is aborted on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { RowLabel } from './SettingsLayout';
import { AppleIntelligenceProvider } from '../../lib/assistant/providers/apple-intelligence';
import { runFmTimeEval, FM_EVAL_NOW, FM_EVAL_TZ } from '../../lib/assistant/fm-eval';
import { log, LogLevel } from '../../lib/logger';

type EvalState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; pass: number; total: number }
  | { phase: 'error' };

export function AssistantFmEvalRow() {
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
      const report = await runFmTimeEval(
        // Temperature 0: eval numbers must be reproducible run to run. Chat
        // keeps the app temperature; only this diagnostic pins it.
        new AppleIntelligenceProvider(0),
        FM_EVAL_NOW,
        FM_EVAL_TZ,
        controller.signal,
        (done, total) => setState({ phase: 'running', done, total }),
      );
      // One line, so the whole report survives in the device log file for
      // pulling; the prefix makes it greppable.
      log.assistant(`FM_EVAL_REPORT ${JSON.stringify(report)}`, LogLevel.INFO);
      setState({ phase: 'done', pass: report.total.pass, total: report.total.total });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      log.assistant('FM eval run failed', LogLevel.ERROR, {
        error: error instanceof Error ? error.message : String(error),
      });
      setState({ phase: 'error' });
    } finally {
      abortRef.current = null;
    }
  }, []);

  return (
    <div className="px-4 py-3 space-y-2" data-testid="assistant-fm-eval">
      <RowLabel label={t('settings.assistant.fm_eval')} desc={t('settings.assistant.fm_eval_hint')} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={handleRun}
          data-testid="fm-eval-run"
        >
          {running
            ? t('settings.assistant.fm_eval_running', { done: state.done, total: state.total })
            : t('settings.assistant.fm_eval_run')}
        </Button>
        {state.phase === 'done' && (
          <span className="text-xs text-muted-foreground" data-testid="fm-eval-score">
            {t('settings.assistant.fm_eval_score', { pass: state.pass, total: state.total })}
          </span>
        )}
        {state.phase === 'error' && (
          <span className="text-xs text-destructive" data-testid="fm-eval-error">
            {t('settings.assistant.fm_eval_failed')}
          </span>
        )}
      </div>
    </div>
  );
}
