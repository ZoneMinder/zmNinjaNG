/**
 * Assistant Section (refs #246)
 *
 * Master toggle plus model picker for the on-device assistant (Ask). The
 * model runs entirely in-browser via WebGPU (`@mlc-ai/web-llm`), so the
 * toggle is disabled with an explanation once the real `useWebGpuAvailable`
 * probe (`navigator.gpu.requestAdapter()`, not just `navigator.gpu`
 * presence) reports no usable adapter. Download/Delete wire directly into
 * `lib/assistant/model-download.ts`: `downloadModel` creates a
 * `backgroundTasks` task itself (the existing background-tasks drawer shows
 * the progress bar and a cancel button), so this component only tracks
 * whether the selected model is downloaded and whether a download/delete is
 * in flight, to enable/disable the two buttons.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { SectionHeader, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { useWebGpuAvailable } from '../../hooks/useWebGpuAvailable';
import { useToast } from '../../hooks/use-toast';
import { deleteModel, downloadModel, isModelDownloaded } from '../../lib/assistant/model-download';
import { log, LogLevel } from '../../lib/logger';
import type { Profile } from '../../api/types';
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

  const selectedModel =
    ASSISTANT.webllmModels.find((m) => m.id === settings.assistantModelId) ?? ASSISTANT.webllmModels[0];

  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('checking');
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const handleDownload = useCallback(async () => {
    const modelId = settings.assistantModelId;
    setDownloading(true);
    try {
      // `downloadModel` reports failures onto its background task rather
      // than rejecting (so the task drawer shows the error), so the real
      // outcome has to be read back from the cache instead of a catch here.
      await downloadModel(modelId);
      const downloaded = await isModelDownloaded(modelId);
      setDownloadStatus(downloaded ? 'downloaded' : 'not-downloaded');
      if (!downloaded) {
        toast({
          title: t('common.error'),
          description: t('settings.assistant.download_failed'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      log.assistant('downloadModel threw', LogLevel.ERROR, { modelId, error });
      setDownloadStatus('not-downloaded');
      toast({
        title: t('common.error'),
        description: t('settings.assistant.download_failed'),
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  }, [settings.assistantModelId, t, toast]);

  const handleDelete = useCallback(async () => {
    const modelId = settings.assistantModelId;
    setDeleting(true);
    try {
      await deleteModel(modelId);
      setDownloadStatus('not-downloaded');
    } catch (error) {
      log.assistant('deleteModel failed', LogLevel.ERROR, { modelId, error });
      toast({
        title: t('common.error'),
        description: t('settings.assistant.delete_failed'),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }, [settings.assistantModelId, t, toast]);

  return (
    <section>
      <SectionHeader label={t('settings.assistant.title')} />
      <SettingsCard>
        <SettingsRow>
          <RowLabel
            label={t('settings.assistant.enable')}
            desc={webGpuUnavailable ? t('settings.assistant.no_webgpu') : t('settings.assistant.subtitle')}
          />
          <Switch
            id="assistant-enabled"
            checked={settings.assistantEnabled}
            disabled={hasWebGPU !== true}
            onCheckedChange={(checked) => update('assistantEnabled', checked)}
            data-testid="assistant-enabled-toggle"
          />
        </SettingsRow>

        {settings.assistantEnabled && hasWebGPU === true && (
          <>
            <div className="px-4 py-3 space-y-2">
              <RowLabel label={t('settings.assistant.model')} />
              <select
                className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                value={settings.assistantModelId}
                onChange={(e) =>
                  currentProfile && updateSettings(currentProfile.id, { assistantModelId: e.target.value })
                }
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

            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">{t('settings.assistant.privacy')}</p>
            </div>
          </>
        )}
      </SettingsCard>
    </section>
  );
}
