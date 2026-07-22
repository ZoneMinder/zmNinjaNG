/**
 * Native (on-device llama.cpp bridge) backend settings (refs #270)
 *
 * Rendered by `AssistantSection.tsx` when `settings.assistantBackend ===
 * 'native'` and the platform's `NativeLlm.isSupported()` probe passed. One
 * fixed model (`ASSISTANT.nativeLlmModel`), unlike the WebLLM on-device
 * section, so there is no model picker here, only download/delete/storage.
 * Download/Delete wire into `lib/assistant/native-model-download.ts`:
 * `downloadNativeModel` creates a `backgroundTasks` task itself (tagged with
 * `metadata.modelId`), so the existing background-tasks drawer shows the
 * progress bar and cancel button unchanged, and this component only tracks
 * whether the model is downloaded and whether a download/delete is in
 * flight, the same split `AssistantSection`'s WebLLM block uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { RowLabel } from './SettingsLayout';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import {
  downloadNativeModel,
  deleteNativeModel,
  isNativeModelDownloaded,
  type NativeModelStatus,
} from '../../lib/assistant/native-model-download';
import { formatStorageBytes } from '../../lib/assistant/model-storage';
import { useBackgroundTasks, type BackgroundTask } from '../../stores/backgroundTasks';
import { useToast } from '../../hooks/use-toast';
import { log, LogLevel } from '../../lib/logger';

type DownloadStatus = 'checking' | 'not-downloaded' | 'downloaded';

export function AssistantNativeSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const model = ASSISTANT.nativeLlmModel;

  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('checking');
  const [deleting, setDeleting] = useState(false);
  const [storage, setStorage] = useState<NativeModelStatus | undefined>(undefined);

  // Guards post-await setState from running after unmount. Re-set on every
  // mount (see AssistantSection.tsx for why: StrictMode's mount/unmount/
  // remount would otherwise leave it false for the remounted component's
  // whole life).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const tasks = useBackgroundTasks((s) => s.tasks);
  const downloadTask = useMemo<BackgroundTask | undefined>(() => {
    let match: BackgroundTask | undefined;
    for (const task of tasks) {
      if (task.type === 'download' && task.metadata?.modelId === model.id) match = task;
    }
    return match;
  }, [tasks, model.id]);
  const downloading = downloadTask?.status === 'pending' || downloadTask?.status === 'in_progress';

  /** Resolves to whether the model is actually on disk, or `undefined` if the
   *  probe itself failed (already logged/handled by the catch below). Sets
   *  state directly to the resolved value with no interim 'checking' write:
   *  the completion-recheck effect below re-runs on every render (its deps
   *  include `t`, which react-i18next's `useTranslation()` is not guaranteed
   *  to return a stable reference for), so an interim value that differs from
   *  both the current and the final state would keep triggering new renders
   *  and never settle. Callers that want the 'checking' UI (mount) set it
   *  themselves before calling this. */
  const probeDownloaded = useCallback((): Promise<boolean | undefined> => {
    return isNativeModelDownloaded()
      .then((result) => {
        if (!mountedRef.current) return result.downloaded;
        setDownloadStatus(result.downloaded ? 'downloaded' : 'not-downloaded');
        setStorage(result.downloaded ? result : undefined);
        return result.downloaded;
      })
      .catch((error) => {
        log.assistant('isNativeModelDownloaded check failed', LogLevel.ERROR, { error });
        if (mountedRef.current) setDownloadStatus('not-downloaded');
        return undefined;
      });
  }, []);

  useEffect(() => {
    setDownloadStatus('checking');
    void probeDownloaded();
    // Mount only: re-probing on every render belongs to the completion-recheck
    // effect below, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-checks the moment the download task reaches a terminal state, instead
  // of waiting on `handleDownload`'s own promise chain (same reasoning as
  // AssistantSection.tsx's WebLLM block). A completed task that turns out not
  // to be on disk (the native side reported done but the file isn't there)
  // surfaces the same failure toast the WebLLM block shows.
  useEffect(() => {
    if (!downloadTask) return;

    if (downloadTask.status === 'completed') {
      void probeDownloaded().then((downloaded) => {
        if (downloaded === false) {
          toast({
            title: t('common.error'),
            description: t('settings.assistant.download_failed'),
            variant: 'destructive',
          });
        }
      });
    }

    if (downloadTask.status === 'failed') {
      setDownloadStatus('not-downloaded');
      toast({
        title: t('common.error'),
        description: t('settings.assistant.download_failed'),
        variant: 'destructive',
      });
    }
  }, [downloadTask?.id, downloadTask?.status, probeDownloaded, t, toast]);

  const handleDownload = useCallback(() => {
    downloadNativeModel().catch((error) => {
      log.assistant('downloadNativeModel threw', LogLevel.ERROR, { error });
    });
  }, []);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteNativeModel();
      if (mountedRef.current) setDownloadStatus('not-downloaded');
    } catch (error) {
      log.assistant('deleteNativeModel failed', LogLevel.ERROR, { error });
      if (mountedRef.current) {
        toast({
          title: t('common.error'),
          description: t('settings.assistant.delete_failed'),
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }, [t, toast]);

  return (
    <>
      <div className="px-4 py-3 space-y-2">
        <RowLabel label={t('settings.assistant.model')} />
        <p className="text-sm truncate min-w-0" title={model.label}>
          {model.label}
        </p>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={downloadStatus !== 'not-downloaded' || downloading || deleting}
            onClick={handleDownload}
            data-testid="assistant-native-model-download"
          >
            {downloading ? t('settings.assistant.downloading') : t('settings.assistant.download')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={downloadStatus !== 'downloaded' || downloading || deleting}
            onClick={() => void handleDelete()}
            data-testid="assistant-native-model-delete"
          >
            {t('settings.assistant.delete')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('settings.assistant.download_size', { size: model.approxSizeMb })}
          </span>
          {downloadStatus === 'downloaded' && (
            <span className="text-xs text-muted-foreground" data-testid="assistant-native-model-downloaded-status">
              {t('settings.assistant.downloaded')}
            </span>
          )}
        </div>
      </div>

      {downloadStatus === 'downloaded' && storage && (
        <div className="px-4 py-3 space-y-1 min-w-0" data-testid="assistant-native-model-storage">
          {storage.path && (
            <p className="text-xs text-muted-foreground truncate min-w-0" title={storage.path}>
              {t('settings.assistant.storage_path', { path: storage.path })}
            </p>
          )}
          {storage.sizeBytes !== undefined && (
            <p className="text-xs text-muted-foreground">
              {t('settings.assistant.storage_used', { size: formatStorageBytes(storage.sizeBytes) })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('settings.assistant.storage_note')}</p>
        </div>
      )}

      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{t('settings.assistant.privacy')}</p>
      </div>
    </>
  );
}
