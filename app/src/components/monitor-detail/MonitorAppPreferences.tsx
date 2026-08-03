/**
 * Per-monitor app preferences shown at the top of the settings dialog's Video
 * tab.
 *
 * These rows are NOT ZoneMinder monitor fields. They are profile settings keyed
 * by monitor id, so each one applies the moment it is toggled and none of them
 * take part in the dialog's change detection or its Save payload. Sending one to
 * the ZM API would try to write a column that does not exist.
 */

import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { SettingsRow } from './SettingsRow';
import { useSettingsStore } from '../../stores/settings';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import type { Monitor, ProfileId } from '../../api/types';

interface MonitorAppPreferencesProps {
  monitor: Monitor;
  /** Owning profile for an /all/ deep route or All-mode monitor grid; defaults to the current profile. */
  profileId?: ProfileId;
}

export function MonitorAppPreferences({ monitor, profileId }: MonitorAppPreferencesProps) {
  const { t } = useTranslation();
  const { currentProfile } = useCurrentProfile();
  const effectiveProfileId = profileId ?? currentProfile?.id;
  const getProfileSettings = useSettingsStore((state) => state.getProfileSettings);
  const updateProfileSettings = useSettingsStore((state) => state.updateProfileSettings);
  const profileSettings = effectiveProfileId ? getProfileSettings(effectiveProfileId) : null;

  const globalStreamingMethod = profileSettings?.streamingMethod ?? 'auto';
  const monitorOverride = profileSettings?.monitorStreamingOverrides?.[monitor.Id];
  const effectiveGo2rtc = (monitorOverride ?? globalStreamingMethod) === 'auto';
  const monitorSupportsGo2rtc = monitor.Go2RTCEnabled === true;

  const handleGo2rtcToggle = (enabled: boolean) => {
    if (!effectiveProfileId || !profileSettings) return;

    if (!enabled && globalStreamingMethod === 'auto' && !monitorOverride) {
      // Turning off Go2RTC for this monitor while global is 'auto':
      // Set global to 'auto' (keep it), store per-monitor override to 'mjpeg'
      toast.info(t('monitor_detail.go2rtc_override_note'));
    }

    const overrides = { ...(profileSettings.monitorStreamingOverrides ?? {}) };
    if (enabled) {
      // Remove override: inherit global
      delete overrides[monitor.Id];
    } else {
      overrides[monitor.Id] = 'mjpeg';
    }
    updateProfileSettings(effectiveProfileId, { monitorStreamingOverrides: overrides });
  };

  const forceZms = profileSettings?.forceZmsMonitorIds?.includes(monitor.Id) ?? false;

  const handleForceZmsToggle = (enabled: boolean) => {
    if (!effectiveProfileId || !profileSettings) return;
    const others = (profileSettings.forceZmsMonitorIds ?? []).filter((id) => id !== monitor.Id);
    updateProfileSettings(effectiveProfileId, {
      forceZmsMonitorIds: enabled ? [...others, monitor.Id] : others,
    });
  };

  return (
    <>
      <SettingsRow label={t('monitor_detail.force_zms_label')} testId="settings-force-zms-row">
        <Switch
          checked={forceZms}
          onCheckedChange={handleForceZmsToggle}
          aria-label={t('monitor_detail.force_zms_label')}
          data-testid="settings-monitor-force-zms-switch"
        />
      </SettingsRow>

      {/* Per-monitor Go2RTC toggle: only shown when monitor supports it */}
      {monitorSupportsGo2rtc && (
        <SettingsRow label={t('monitor_detail.go2rtc_label')} testId="settings-go2rtc-row">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-yellow-500" />
            <Switch
              checked={effectiveGo2rtc}
              onCheckedChange={handleGo2rtcToggle}
              data-testid="settings-monitor-go2rtc-switch"
            />
            {monitorOverride === 'mjpeg' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                MJPEG
              </Badge>
            )}
          </div>
        </SettingsRow>
      )}
    </>
  );
}
