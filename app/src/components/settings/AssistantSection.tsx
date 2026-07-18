/**
 * Assistant Section (refs #246)
 *
 * Master toggle, backend picker, and per-backend config for the in-app
 * assistant (Ask). Two backends: the on-device WebLLM model
 * (`@mlc-ai/web-llm`, requires WebGPU) or a remote OpenAI-compatible server
 * such as Ollama (`AssistantOllamaSection.tsx`, no WebGPU needed, works on
 * iOS/low-end devices). The master toggle is NOT gated on WebGPU: Ollama
 * works without it, so only the on-device sub-section below disables itself
 * (and explains why) when `useWebGpuAvailable`'s real
 * `navigator.gpu.requestAdapter()` probe reports no usable adapter.
 * Download/Delete wire directly into `lib/assistant/model-download.ts`:
 * `downloadModel` creates a `backgroundTasks` task itself (the existing
 * background-tasks drawer shows the progress bar and a cancel button), so
 * this component only tracks whether the selected model is downloaded and
 * whether a download/delete is in flight, to enable/disable the two buttons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { SectionHeader, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { AssistantOllamaSection } from './AssistantOllamaSection';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { useWebGpuAvailable } from '../../hooks/useWebGpuAvailable';
import { Platform } from '../../lib/platform';
import { useToast } from '../../hooks/use-toast';
import { deleteModel, downloadModel, isModelDownloaded } from '../../lib/assistant/model-download';
import { getModelStorageInfo, formatStorageBytes, type ModelStorageInfo } from '../../lib/assistant/model-storage';
import { useBackgroundTasks, type BackgroundTask } from '../../stores/backgroundTasks';
import { log, LogLevel } from '../../lib/logger';
import type { Profile } from '../../api/types';
import type { AssistantBackend } from '../../lib/assistant/types';
import type { ProfileSettings } from '../../stores/settings';

/** 'checking': the `isModelDownloaded` probe for the currently selected model
 *  is in flight (e.g. right after mount or after switching models). Both
 *  buttons stay disabled in this state so neither can fire against a model
 *  whose real cache state isn't known yet. */
type DownloadStatus = 'checking' | 'not-downloaded' | 'downloaded';

export interface AssistantSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  currentProfile: Profile | null;
  updateSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;
}

export function AssistantSection({
  settings,
  update,
  currentProfile,
  updateSettings,
}: AssistantSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  // undefined while the requestAdapter() probe is in flight, then the real
  // result. Until it resolves the toggle stays disabled (same as "no
  // WebGPU") but without claiming the device lacks WebGPU.
  const hasWebGPU = useWebGpuAvailable();
  const webGpuUnavailable = hasWebGPU === false;
  // Not offered on any phone/tablet: this is memory, not WebGPU (mobile has
  // WebGPU). A WebView renderer is memory-capped and every WebLLM model plus
  // the app heap and KV cache exceeds it, crashing the app mid-load. On iOS the
  // WKWebView content process hits a hard 2 GB jetsam ceiling; on Android the
  // renderer is killed and the OS fires a device-wide low-memory event (both
  // verified on device, refs #246). The Ollama backend runs the model on a
  // server and has no such limit. Desktop (web/Electron) is not native, so it
  // keeps on-device.
  const onDeviceUnsupported = Platform.isIOS || Platform.isAndroid;

  const selectedModel =
    ASSISTANT.webllmModels.find((m) => m.id === settings.assistantModelId) ?? ASSISTANT.webllmModels[0];

  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('checking');
  const [deleting, setDeleting] = useState(false);
  const [storageInfo, setStorageInfo] = useState<ModelStorageInfo | undefined>(undefined);

  // The backgroundTasks store is the authoritative source for download
  // progress: `downloadModel` reports into it directly, so deriving
  // `downloading` from the store (instead of a local flag set/cleared around
  // the `handleDownload` promise chain) means a stalled follow-up await in
  // this component can never strand the button in "Downloading...". Selects
  // the raw `tasks` array (rule 30 field selector) and derives the match
  // locally rather than subscribing with an inline `.find()` selector, which
  // would return a new reference every render and defeat memoization.
  const tasks = useBackgroundTasks((s) => s.tasks);
  const modelId = settings.assistantModelId;

  const downloadTask = useMemo<BackgroundTask | undefined>(() => {
    let match: BackgroundTask | undefined;
    for (const task of tasks) {
      if (task.type === 'download' && task.metadata?.modelId === modelId) match = task;
    }
    return match;
  }, [tasks, modelId]);

  const downloading = downloadTask?.status === 'pending' || downloadTask?.status === 'in_progress';

  // Latest selected model id, read *after* the awaits below resolve. The
  // select is disabled while downloading/deleting (primary guard), but a
  // parent could still push a different `assistantModelId` mid-operation
  // (e.g. profile switch), so a stale download/delete resolving must not
  // clobber the status of whatever model is displayed by then.
  const selectedModelIdRef = useRef(settings.assistantModelId);
  useEffect(() => {
    selectedModelIdRef.current = settings.assistantModelId;
  }, [settings.assistantModelId]);

  // Guards post-await setState from running after unmount. Re-set on every
  // mount: StrictMode's mount/unmount/remount would otherwise leave it false
  // for the remounted component's whole life, dropping every guarded update.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDownloadStatus('checking');
    isModelDownloaded(settings.assistantModelId)
      .then((downloaded) => {
        if (!cancelled) setDownloadStatus(downloaded ? 'downloaded' : 'not-downloaded');
      })
      .catch((error) => {
        log.assistant('isModelDownloaded check failed', LogLevel.ERROR, { modelId: settings.assistantModelId, error });
        if (!cancelled) setDownloadStatus('not-downloaded');
      });
    return () => {
      cancelled = true;
    };
  }, [settings.assistantModelId]);

  // Re-checks the cache the moment this model's download task reaches a
  // terminal state, instead of waiting on `handleDownload`'s own promise
  // chain to resolve (which is what used to strand the button in
  // "Downloading..." if that chain stalled after the task had already
  // completed). Keyed on the task's id+status rather than the task object
  // itself so it only re-runs on an actual transition, not on every
  // `updateProgress` tick (those keep `status` at 'in_progress').
  useEffect(() => {
    if (!downloadTask) return;
    const taskModelId = downloadTask.metadata?.modelId;
    if (!taskModelId) return;

    if (downloadTask.status === 'completed') {
      let cancelled = false;
      isModelDownloaded(taskModelId)
        .then((downloaded) => {
          if (cancelled) return;
          setDownloadStatus(downloaded ? 'downloaded' : 'not-downloaded');
          if (!downloaded) {
            toast({
              title: t('common.error'),
              description: t('settings.assistant.download_failed'),
              variant: 'destructive',
            });
          }
        })
        .catch((error) => {
          log.assistant('isModelDownloaded re-check failed', LogLevel.ERROR, { modelId: taskModelId, error });
          if (!cancelled) setDownloadStatus('not-downloaded');
        });
      return () => {
        cancelled = true;
      };
    }

    if (downloadTask.status === 'failed') {
      setDownloadStatus('not-downloaded');
      toast({
        title: t('common.error'),
        description: t('settings.assistant.download_failed'),
        variant: 'destructive',
      });
    }
  }, [downloadTask?.id, downloadTask?.status, downloadTask?.metadata?.modelId, t, toast]);

  // Storage info (backend/usage/persisted/OS path) is only meaningful once
  // there's something on disk to describe, and re-probed whenever a
  // download/delete flips `downloadStatus`, so a Download right after this
  // panel first renders picks up fresh numbers instead of stale "not
  // downloaded" state.
  useEffect(() => {
    if (downloadStatus !== 'downloaded') {
      setStorageInfo(undefined);
      return;
    }
    let cancelled = false;
    getModelStorageInfo()
      .then((info) => {
        if (!cancelled) setStorageInfo(info);
      })
      .catch((error) => {
        log.assistant('getModelStorageInfo failed', LogLevel.ERROR, { error });
      });
    return () => {
      cancelled = true;
    };
  }, [downloadStatus, settings.assistantModelId]);

  // Only starts the download; `downloadModel` reports progress/completion/
  // failure onto its background task itself (the effect above reacts to
  // that), so this no longer owns a local "in flight" flag or gates button
  // state on its own promise settling.
  const handleDownload = useCallback(() => {
    const modelId = settings.assistantModelId;
    downloadModel(modelId).catch((error) => {
      // `downloadModel` normally reports failures onto its background task
      // rather than rejecting; this only catches an unexpected throw before
      // that task bookkeeping runs.
      log.assistant('downloadModel threw', LogLevel.ERROR, { modelId, error });
    });
  }, [settings.assistantModelId]);

  const handleDelete = useCallback(async () => {
    const modelId = settings.assistantModelId;
    setDeleting(true);
    try {
      await deleteModel(modelId);
      if (mountedRef.current && selectedModelIdRef.current === modelId) {
        setDownloadStatus('not-downloaded');
      }
    } catch (error) {
      log.assistant('deleteModel failed', LogLevel.ERROR, { modelId, error });
      if (mountedRef.current && selectedModelIdRef.current === modelId) {
        toast({
          title: t('common.error'),
          description: t('settings.assistant.delete_failed'),
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  }, [settings.assistantModelId, t, toast]);

  return (
    <section>
      <SectionHeader label={t('settings.assistant.title')} />
      <SettingsCard>
        <SettingsRow>
          <RowLabel label={t('settings.assistant.enable')} desc={t('settings.assistant.subtitle')} />
          {/* Decorative: the label in this row already names Ninjii. Sized to
              the two-line row it sits in, which is what gives it room to read
              at a glance. */}
          <img src={ASSISTANT.logoPath} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
          <Switch
            id="assistant-enabled"
            checked={settings.assistantEnabled}
            onCheckedChange={(checked) => update('assistantEnabled', checked)}
            data-testid="assistant-enabled-toggle"
          />
        </SettingsRow>

        {settings.assistantEnabled && (
          <>
            <div className="px-4 py-3 space-y-2">
              <RowLabel label={t('settings.assistant.backend')} />
              <select
                className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                value={settings.assistantBackend}
                onChange={(e) => update('assistantBackend', e.target.value as AssistantBackend)}
                data-testid="assistant-backend-select"
              >
                {/* Disabled, not hidden, on iOS: the user still sees the option
                    exists and reads why it is unavailable, rather than it
                    silently vanishing (it works on their desktop). */}
                <option value="on-device" disabled={onDeviceUnsupported}>
                  {t('settings.assistant.backend_on_device')}
                </option>
                <option value="ollama">{t('settings.assistant.backend_ollama')}</option>
              </select>
              {/* Shown on iOS whichever backend is selected, so the greyed-out
                  on-device option is always explained, not only while it is the
                  active one. */}
              {onDeviceUnsupported && (
                <div className="space-y-1 pt-1" data-testid="assistant-mobile-unsupported">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.mobile_unsupported')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.mobile_unsupported_hint')}</p>
                </div>
              )}
            </div>

            {settings.assistantBackend === 'ollama' ? (
              <AssistantOllamaSection settings={settings} update={update} currentProfile={currentProfile} />
            ) : (
              !onDeviceUnsupported &&
              webGpuUnavailable && (
                <div className="px-4 py-3 space-y-1" data-testid="assistant-no-webgpu">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.no_webgpu')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.no_webgpu_hint')}</p>
                </div>
              )
            )}

            {settings.assistantBackend === 'on-device' && hasWebGPU === true && !onDeviceUnsupported && (
              <>
                <div className="px-4 py-3 space-y-2">
                  <RowLabel label={t('settings.assistant.model')} />
                  <select
                    className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                    value={settings.assistantModelId}
                    onChange={(e) =>
                      currentProfile && updateSettings(currentProfile.id, { assistantModelId: e.target.value })
                    }
                    disabled={downloading || deleting}
                    data-testid="assistant-model-select"
                  >
                    {ASSISTANT.webllmModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadStatus !== 'not-downloaded' || downloading || deleting}
                      onClick={handleDownload}
                      data-testid="assistant-model-download"
                    >
                      {downloading ? t('settings.assistant.downloading') : t('settings.assistant.download')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadStatus !== 'downloaded' || downloading || deleting}
                      onClick={handleDelete}
                      data-testid="assistant-model-delete"
                    >
                      {t('settings.assistant.delete')}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {t('settings.assistant.download_size', { size: selectedModel.approxSizeMb })}
                    </span>
                    {downloadStatus === 'downloaded' && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid="assistant-model-downloaded-status"
                      >
                        {t('settings.assistant.downloaded')}
                      </span>
                    )}
                  </div>
                </div>

                {/* An on-device model that loads at all is usually fine; the
                    failure mode is the model's weights plus its KV cache not
                    fitting in VRAM, which surfaces as a crash or a failed load
                    rather than a clean error we can catch and explain in place
                    (refs #246). Naming it here, next to the picker where the
                    size tradeoff is made, is what turns an unexplained crash
                    into a next step. */}
                <div className="px-4 py-3" data-testid="assistant-model-memory-note">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.oom_note')}</p>
                </div>

                {downloadStatus === 'downloaded' && storageInfo && (
                  <div
                    className="px-4 py-3 space-y-1 min-w-0"
                    data-testid="assistant-model-storage"
                  >
                    <p
                      className="text-xs text-muted-foreground truncate min-w-0"
                      title={storageInfo.osPath}
                    >
                      {storageInfo.osPath
                        ? t('settings.assistant.storage_path', { path: storageInfo.osPath })
                        : t(`settings.assistant.storage_browser_${storageInfo.backend}`)}
                    </p>
                    {storageInfo.usageBytes !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings.assistant.storage_used', { size: formatStorageBytes(storageInfo.usageBytes) })}
                      </p>
                    )}
                    {storageInfo.persisted !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {storageInfo.persisted
                          ? t('settings.assistant.storage_persistent_yes')
                          : t('settings.assistant.storage_persistent_no')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{t('settings.assistant.storage_note')}</p>
                  </div>
                )}

                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">{t('settings.assistant.privacy')}</p>
                </div>
              </>
            )}
          </>
        )}
      </SettingsCard>
    </section>
  );
}
