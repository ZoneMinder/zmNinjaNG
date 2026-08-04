/**
 * All Servers Performance Section
 *
 * Rendered only while aggregating, above the per-server profile picker, for
 * the same reason AllServersStreamingSection is: every knob here governs the
 * aggregate as a whole, not the profile picked below it. They all live in the
 * ALL settings bucket (refs #337).
 *
 * These values used to be constants nobody could reach. How many servers a
 * person aggregates, and how much their network and their servers will take,
 * is not something the app can guess: 16 streams is comfortable for two LAN
 * servers and far too many for five over a VPN. So each guardrail is a row
 * here, each with the range the store clamps to and a reset back to the
 * shipped default, which is exactly the constant the consumer used to
 * hardcode.
 *
 * Number rows commit on blur or Enter rather than per keystroke
 * (useClampedNumberField explains why at length). Each number row and the
 * tuning select grows a reset button once it differs from its default, so a
 * section left alone shows no reset buttons at all. The pause-hidden switch
 * has none: a two-state control is already its own way back.
 */

import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { CollapsibleSection, SettingsCard, SettingsRow, RowLabel } from './SettingsLayout';
import { useClampedNumberField } from '../../hooks/useClampedNumberField';
import { ALL_MODE_PERFORMANCE } from '../../lib/zmninja-ng-constants';
import { DEFAULT_SETTINGS } from '../../stores/settings';
import type { AllModeStreamTuning, ProfileSettings } from '../../stores/settings';

export interface AllServersPerformanceSectionProps {
  /** The ALL bucket: this section only renders while aggregating. */
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
}

/** The reset control, present only while the row differs from its default.
 *  Its own component so every row gets the same label, icon and testid shape
 *  rather than three near-copies. */
function ResetButton({
  testId,
  label,
  show,
  onReset,
}: {
  testId: string;
  label: string;
  show: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0 flex-shrink-0"
      onClick={onReset}
      aria-label={t('settings.all_mode_perf.reset_aria', { label })}
      data-testid={testId}
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </Button>
  );
}

/** One numeric knob: label, blur-committed input, unit, reset. */
function NumberRow({
  id,
  label,
  desc,
  unit,
  value,
  defaultValue,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  desc: string;
  unit?: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  const { t } = useTranslation();
  const field = useClampedNumberField(value, min, max, onCommit);

  return (
    <SettingsRow>
      <RowLabel
        label={label}
        desc={`${desc} ${t('settings.all_mode_perf.default_hint', { value: defaultValue })}`}
      />
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={field.draft}
          onChange={(e) => field.onChange(e.target.value)}
          onFocus={field.onFocus}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
          className="w-20"
          aria-label={label}
          data-testid={`${id}-input`}
        />
        {/* The unit rides beside the box because a number input cannot hold
            text. aria-hidden: the row's own description already says what the
            number counts, so announcing it again mid-value only repeats it. */}
        {unit && (
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            {unit}
          </span>
        )}
        <ResetButton
          testId={`${id}-reset`}
          label={label}
          show={value !== defaultValue}
          onReset={() => onCommit(defaultValue)}
        />
      </div>
    </SettingsRow>
  );
}

export function AllServersPerformanceSection({
  settings,
  update,
}: AllServersPerformanceSectionProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleSection
      id="all-servers-performance"
      label={t('settings.all_mode_perf.title')}
    >
      <SettingsCard>
        <NumberRow
          id="all-mode-max-streams"
          label={t('settings.all_mode_perf.max_streams_label')}
          desc={t('settings.all_mode_perf.max_streams_desc')}
          value={settings.allModeMaxStreams}
          defaultValue={DEFAULT_SETTINGS.allModeMaxStreams}
          min={ALL_MODE_PERFORMANCE.minStreams}
          max={ALL_MODE_PERFORMANCE.maxStreams}
          onCommit={(next) => update('allModeMaxStreams', next)}
        />

        <NumberRow
          id="all-mode-max-watched"
          label={t('settings.all_mode_perf.max_watched_label')}
          desc={t('settings.all_mode_perf.max_watched_desc')}
          value={settings.allModeMaxWatched}
          defaultValue={DEFAULT_SETTINGS.allModeMaxWatched}
          min={ALL_MODE_PERFORMANCE.minWatched}
          max={ALL_MODE_PERFORMANCE.maxWatched}
          onCommit={(next) => update('allModeMaxWatched', next)}
        />

        <NumberRow
          id="all-mode-poll-floor"
          label={t('settings.all_mode_perf.poll_floor_label')}
          desc={t('settings.all_mode_perf.poll_floor_desc')}
          unit={t('settings.all_mode_perf.unit_seconds')}
          value={settings.allModePollFloorSeconds}
          defaultValue={DEFAULT_SETTINGS.allModePollFloorSeconds}
          min={ALL_MODE_PERFORMANCE.minPollFloorSeconds}
          max={ALL_MODE_PERFORMANCE.maxPollFloorSeconds}
          onCommit={(next) => update('allModePollFloorSeconds', next)}
        />

        <NumberRow
          id="all-mode-burst-window"
          label={t('settings.all_mode_perf.burst_window_label')}
          desc={t('settings.all_mode_perf.burst_window_desc')}
          unit={t('settings.all_mode_perf.unit_seconds')}
          value={settings.allModeBurstSeconds}
          defaultValue={DEFAULT_SETTINGS.allModeBurstSeconds}
          min={ALL_MODE_PERFORMANCE.minBurstSeconds}
          max={ALL_MODE_PERFORMANCE.maxBurstSeconds}
          onCommit={(next) => update('allModeBurstSeconds', next)}
        />

        <SettingsRow>
          <RowLabel
            label={t('settings.all_mode_perf.stream_tuning_label')}
            desc={t('settings.all_mode_perf.stream_tuning_desc')}
          />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Select
              value={settings.allModeStreamTuning}
              onValueChange={(next) => update('allModeStreamTuning', next as AllModeStreamTuning)}
            >
              <SelectTrigger
                className="w-36"
                aria-label={t('settings.all_mode_perf.stream_tuning_label')}
                data-testid="all-mode-stream-tuning-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off" data-testid="all-mode-stream-tuning-option-off">
                  {t('settings.all_mode_perf.stream_tuning_off')}
                </SelectItem>
                <SelectItem value="reduced" data-testid="all-mode-stream-tuning-option-reduced">
                  {t('settings.all_mode_perf.stream_tuning_reduced')}
                </SelectItem>
              </SelectContent>
            </Select>
            <ResetButton
              testId="all-mode-stream-tuning-reset"
              label={t('settings.all_mode_perf.stream_tuning_label')}
              show={settings.allModeStreamTuning !== DEFAULT_SETTINGS.allModeStreamTuning}
              onReset={() => update('allModeStreamTuning', DEFAULT_SETTINGS.allModeStreamTuning)}
            />
          </div>
        </SettingsRow>

        <SettingsRow>
          <RowLabel
            label={t('settings.all_mode_perf.pause_hidden_label')}
            desc={t('settings.all_mode_perf.pause_hidden_desc')}
          />
          <Switch
            checked={settings.allModePauseHidden}
            onCheckedChange={(checked) => update('allModePauseHidden', checked)}
            aria-label={t('settings.all_mode_perf.pause_hidden_label')}
            data-testid="all-mode-pause-hidden-switch"
          />
        </SettingsRow>

        <NumberRow
          id="all-mode-idle-minutes"
          label={t('settings.all_mode_perf.idle_minutes_label')}
          desc={t('settings.all_mode_perf.idle_minutes_desc')}
          unit={t('settings.all_mode_perf.unit_minutes')}
          value={settings.allModeIdleMinutes}
          defaultValue={DEFAULT_SETTINGS.allModeIdleMinutes}
          min={ALL_MODE_PERFORMANCE.minIdleMinutes}
          max={ALL_MODE_PERFORMANCE.maxIdleMinutes}
          onCommit={(next) => update('allModeIdleMinutes', next)}
        />
      </SettingsCard>
    </CollapsibleSection>
  );
}
