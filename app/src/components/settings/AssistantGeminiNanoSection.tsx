/**
 * Gemini Nano weight download (refs #270).
 *
 * The one control the Android system backend needs that the Apple one does not. Apple
 * Foundation Models ships with iOS, so `AssistantSection` renders nothing for it beyond the
 * eval row; AICore downloads Gemini Nano on request, so the normal first-run state of this
 * backend is `reason: 'notReady'` and this row is what resolves it.
 *
 * Deliberately not a copy of `AssistantNativeSection`: there is no model to choose, no size
 * to show before the fact (AICore reports the total only once the download starts) and no
 * delete, because the weights are the system's and shared with every other app that uses
 * them. Download progress reuses that section's locale keys rather than adding parallel
 * copy for the same three words.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginListenerHandle } from '@capacitor/core';
import { log, LogLevel } from '../../lib/logger';

interface Props {
  /** Re-probes `isSupported()` so the backend becomes selectable once the weights land,
   *  without an app restart. */
  onDownloaded: () => void;
}

export function AssistantGeminiNanoSection({ onDownloaded }: Props) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const listener = useRef<PluginListenerHandle | null>(null);

  // The listener outlives a single render but not the row: a download left running when the
  // user navigates away would otherwise keep calling setState on an unmounted component.
  useEffect(() => {
    return () => {
      void listener.current?.remove();
      listener.current = null;
    };
  }, []);

  const startDownload = async () => {
    setError(undefined);
    setDownloading(true);
    setProgress(undefined);
    try {
      const { GeminiNano } = await import('../../plugins/gemini-nano');
      listener.current = await GeminiNano.addListener('downloadProgress', (p) => {
        // AICore reports the total only after the download starts, so guard the divide
        // rather than rendering NaN% for the first tick.
        if (p.totalBytes > 0) setProgress(p.bytesDownloaded / p.totalBytes);
      });
      await GeminiNano.download();
      onDownloaded();
    } catch (e) {
      log.assistant('Gemini Nano download failed', LogLevel.ERROR, { error: e });
      const reason = e instanceof Error ? e.message : String(e);
      setError(reason ? t('settings.assistant.download_failed_reason', { reason }) : t('settings.assistant.download_failed'));
    } finally {
      await listener.current?.remove();
      listener.current = null;
      setDownloading(false);
    }
  };

  return (
    <div className="px-4 py-3 space-y-2" data-testid="assistant-gemini-nano-download">
      <p className="text-xs text-muted-foreground">{t('settings.assistant.gemini_nano_not_ready')}</p>
      <button
        type="button"
        className="text-sm border rounded px-3 py-1.5 disabled:opacity-50"
        onClick={() => void startDownload()}
        disabled={downloading}
        data-testid="assistant-gemini-nano-download-button"
      >
        {downloading
          ? progress === undefined
            ? t('settings.assistant.downloading')
            : `${t('settings.assistant.downloading')} ${Math.round(progress * 100)}%`
          : t('settings.assistant.download')}
      </button>
      {error && (
        <p className="text-xs text-destructive" data-testid="assistant-gemini-nano-download-error">
          {error}
        </p>
      )}
    </div>
  );
}
