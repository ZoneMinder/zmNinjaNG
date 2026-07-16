/**
 * Assistant Section (refs #246)
 *
 * Master toggle plus model picker for the on-device assistant (Ask). The
 * model runs entirely in-browser via WebGPU (`@mlc-ai/web-llm`, wired in
 * Phase 2), so the toggle is disabled with an explanation when `navigator.gpu`
 * is absent. Download/Delete are rendered here as the Phase 1 placeholder the
 * design spec calls for (docs/superpowers/specs/2026-07-16-assistant-design.md):
 * Phase 2 wires the real WebLLM download/cache/delete manager.
 */

import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { SectionHeader, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

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

  // Phase 2 refines this probe (device-specific quirks, e.g. iOS WebGPU
  // availability); for now presence of the API is the whole gate. `gpu` isn't
  // in the project's DOM lib typings (no @webgpu/types dependency), hence the cast.
  const hasWebGPU =
    typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;

  const selectedModel =
    ASSISTANT.webllmModels.find((m) => m.id === settings.assistantModelId) ?? ASSISTANT.webllmModels[0];

  return (
    <section>
      <SectionHeader label={t('settings.assistant.title')} />
      <SettingsCard>
        <SettingsRow>
          <RowLabel
            label={t('settings.assistant.enable')}
            desc={hasWebGPU ? t('settings.assistant.subtitle') : t('settings.assistant.no_webgpu')}
          />
          <Switch
            id="assistant-enabled"
            checked={settings.assistantEnabled}
            disabled={!hasWebGPU}
            onCheckedChange={(checked) => update('assistantEnabled', checked)}
            data-testid="assistant-enabled-toggle"
          />
        </SettingsRow>

        {settings.assistantEnabled && hasWebGPU && (
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
                <Button variant="outline" size="sm" disabled data-testid="assistant-model-download">
                  {t('settings.assistant.download')}
                </Button>
                <Button variant="outline" size="sm" disabled data-testid="assistant-model-delete">
                  {t('settings.assistant.delete')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('settings.assistant.download_size', { size: selectedModel.approxSizeMb })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.assistant.coming_soon')}</p>
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
