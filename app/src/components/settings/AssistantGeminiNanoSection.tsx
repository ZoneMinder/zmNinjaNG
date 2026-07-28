/**
 * Gemini Nano weight download (refs #270).
 *
 * The one control the Android system backend needs that the Apple one does not.
 * Apple Foundation Models ships with iOS, so `AssistantSection` renders nothing for
 * it beyond the eval row; AICore downloads Gemini Nano on request, so the normal
 * first-run state of this backend is `reason: 'notReady'` and this row resolves it.
 *
 * Like the two model-download rows before it, this holds no progress state of its
 * own: the download reports through `backgroundTasks` (see `gemini-nano-download.ts`)
 * so it survives this screen unmounting and keeps reporting in the app-level drawer.
 * The row reads its own task back to disable the button and show a failure.
 *
 * Deliberately not a copy of `AssistantNativeSection`: there is no model to choose,
 * no size to show before the fact (AICore reports the total only once the transfer
 * starts) and no delete, because the weights are the system's and shared with every
 * other app that uses them. The download-progress copy is reused rather than
 * duplicated for the same three words.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackgroundTasks } from '../../stores/backgroundTasks';
import { downloadGeminiNanoModel, findGeminiNanoDownloadTask } from '../../lib/assistant/gemini-nano-download';

interface Props {
  /** Re-probes `isSupported()` so the backend becomes selectable once the weights
   *  land, without an app restart. */
  onDownloaded: () => void;
}

export function AssistantGeminiNanoSection({ onDownloaded }: Props) {
  const { t } = useTranslation();
  const task = useBackgroundTasks((state) => findGeminiNanoDownloadTask(state.tasks));
  const downloading = task?.status === 'pending' || task?.status === 'in_progress';

  // Re-probe when the download finishes, including one that completed while this
  // row was unmounted: the row may mount straight into a completed task, and the
  // ref keeps that from re-firing on every later render.
  const notified = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (task?.status === 'completed' && notified.current !== task.id) {
      notified.current = task.id;
      onDownloaded();
    }
  }, [task?.status, task?.id, onDownloaded]);

  const startDownload = useCallback(() => {
    // Not awaited: the download outlives this component and the task carries its
    // outcome. The rejection is already logged and reported as a failed task.
    void downloadGeminiNanoModel(t('settings.assistant.gemini_nano_not_ready')).catch(() => {});
  }, [t]);

  return (
    <div className="px-4 py-3 space-y-2" data-testid="assistant-gemini-nano-download">
      <p className="text-xs text-muted-foreground">{t('settings.assistant.gemini_nano_not_ready')}</p>
      <button
        type="button"
        className="text-sm border rounded px-3 py-1.5 disabled:opacity-50"
        onClick={startDownload}
        disabled={downloading}
        data-testid="assistant-gemini-nano-download-button"
      >
        {downloading
          ? `${t('settings.assistant.downloading')} ${task?.progress ?? 0}%`
          : t('settings.assistant.download')}
      </button>
      {task?.status === 'failed' && (
        <p className="text-xs text-destructive" data-testid="assistant-gemini-nano-download-error">
          {task.error
            ? t('settings.assistant.download_failed_reason', { reason: task.error.message })
            : t('settings.assistant.download_failed')}
        </p>
      )}
    </div>
  );
}
