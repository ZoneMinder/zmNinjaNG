/**
 * The settings dialog for an account that may not edit ZoneMinder fields.
 *
 * The gear stays on screen because most of what is behind it was never a
 * ZoneMinder field: force-ZMS, the per-monitor Go2RTC override, and the cycle
 * interval are app-local preferences, and they are exactly the knobs a
 * restricted user reaches for when a stream will not play. What goes away is
 * every writable ZM field, and with it the camera's address, username and
 * password - which ZoneMinder hands to any account that can view the monitor,
 * unstripped (refs #344).
 *
 * The read-only rows that survive are the ones a viewer is entitled to and can
 * act on. Control address is not among them: it is another camera address, and
 * of no use to someone who cannot change it.
 */

import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SettingsRow } from './SettingsRow';
import { MonitorAppPreferences } from './MonitorAppPreferences';
import type { Monitor, ProfileId } from '../../api/types';

/** Why the ZoneMinder fields are absent. Decides which note is shown. */
export type RestrictedReason = 'account' | 'monitor';

interface MonitorRestrictedSettingsProps {
  monitor: Monitor;
  profileId?: ProfileId;
  reason: RestrictedReason;
  cycleSeconds?: number;
  onCycleSecondsChange?: (value: string) => void;
  orientedResolution?: string;
  monitorNames?: Record<string, string>;
}

export function MonitorRestrictedSettings({
  monitor,
  profileId,
  reason,
  cycleSeconds,
  onCycleSecondsChange,
  orientedResolution,
  monitorNames,
}: MonitorRestrictedSettingsProps) {
  const { t } = useTranslation();
  const isControllable = monitor.Controllable === '1' || monitor.Controllable === 'true';

  return (
    <div className="mt-2 overflow-y-auto" data-testid="monitor-settings-readonly">
      <MonitorAppPreferences monitor={monitor} profileId={profileId} />

      {onCycleSecondsChange && cycleSeconds !== undefined && (
        <SettingsRow label={t('monitor_detail.cycle_label')} testId="settings-cycle-row" editable>
          <Select value={String(cycleSeconds)} onValueChange={onCycleSecondsChange}>
            <SelectTrigger className="w-32 h-8" data-testid="monitor-detail-cycle-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('monitor_detail.cycle_off')}</SelectItem>
              <SelectItem value="5">{t('monitor_detail.cycle_seconds', { seconds: 5 })}</SelectItem>
              <SelectItem value="10">{t('monitor_detail.cycle_seconds', { seconds: 10 })}</SelectItem>
              <SelectItem value="15">{t('monitor_detail.cycle_seconds', { seconds: 15 })}</SelectItem>
              <SelectItem value="30">{t('monitor_detail.cycle_seconds', { seconds: 30 })}</SelectItem>
              <SelectItem value="60">{t('monitor_detail.cycle_seconds', { seconds: 60 })}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      )}

      <SettingsRow label={t('monitors.resolution')}>
        {orientedResolution ?? `${monitor.Width}x${monitor.Height}`}
      </SettingsRow>

      <SettingsRow label={t('monitors.colours')}>{monitor.Colours}</SettingsRow>

      <SettingsRow label={t('monitors.controllable')}>
        <Badge variant={isControllable ? 'secondary' : 'outline'}>
          {isControllable ? t('common.yes') : t('common.no')}
        </Badge>
      </SettingsRow>

      {monitor.LinkedMonitors && (
        <SettingsRow label={t('monitor_detail.linked_monitors')} testId="settings-linked-monitors">
          <span className="text-xs">
            {monitor.LinkedMonitors.split(',')
              .map((id) => monitorNames?.[id.trim()] ?? `#${id.trim()}`)
              .join(', ')}
          </span>
        </SettingsRow>
      )}

      {/* Muted, not a warning: a correctly restricted account is not an error
          state, and colouring it like one makes the app look broken. */}
      <p
        className="pt-4 text-xs text-muted-foreground"
        data-testid="monitor-settings-restricted-note"
      >
        {reason === 'monitor'
          ? t('monitor_detail.settings_restricted_monitor')
          : t('monitor_detail.settings_restricted_account')}
      </p>
    </div>
  );
}
