/**
 * Live Activity Settings Dialog
 *
 * Poll interval, dwell window, tile cap, and a page-specific monitor ignore
 * list. The ignore list only stops a monitor pulling focus on this page; it
 * stays visible everywhere else. That is separate from the profile-wide
 * monitor exclusion (Settings > hidden monitors), which hides a monitor
 * everywhere.
 *
 * Two-tier while aggregating (refs #337, AGENTS.project.md's Aggregation
 * contract): poll/dwell/tiles are view-level preferences and live in the
 * active aggregate's own bucket (`profileId` below - the real profile id in
 * single mode, the aggregate's id otherwise). The ignore list is a per-server
 * DATA preference and has no meaning in an aggregate bucket, so it edits whichever
 * profile is picked via the shared ProfilePicker (`scopeProfiles`), never
 * `profileId` itself. Single mode passes no `scopeProfiles`, so the picker
 * never renders and the ignore list falls back to editing `profileId`
 * directly - byte-identical to before All mode existed.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { ProfilePicker } from '../profile-picker';
import { useClampedNumberField } from '../../hooks/useClampedNumberField';
import { useSettingsStore, mergeProfileSettings } from '../../stores/settings';
import { LIVE_ACTIVITY } from '../../lib/zmninja-ng-constants';
import type { MonitorData, Profile, ProfileId } from '../../api/types';

export interface LiveActivitySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** View-level bucket for poll/dwell/tiles: the real profile id in single
   *  mode, the active aggregate's id while aggregating. */
  profileId: ProfileId;
  /** Single mode: this profile's monitors, and what the ignore list reads/
   *  writes `profileId` against directly. Ignored when `scopeProfiles` is
   *  given. */
  monitors: MonitorData[];
  /** All mode only: every scope profile plus its own full monitor list.
   *  When present, the ignore-list section shows a ProfilePicker and reads/
   *  writes the PICKED profile's own bucket instead of `profileId` and
   *  `monitors`. */
  scopeProfiles?: { profile: Profile; monitors: MonitorData[] }[];
}

export function LiveActivitySettingsDialog({
  open,
  onOpenChange,
  profileId,
  monitors,
  scopeProfiles,
}: LiveActivitySettingsDialogProps) {
  const { t } = useTranslation();

  const rawSettings = useSettingsStore(
    useShallow((state) => state.profileSettings?.[profileId])
  );
  const settings = useMemo(() => mergeProfileSettings(rawSettings), [rawSettings]);

  // The user's last explicit pick from the ProfilePicker. NOT the ignore-list
  // bucket by itself - this dialog is page-mounted and Radix only toggles it
  // open/closed, so it never unmounts and this state is never reset. Without
  // the derivation below, any in-app profile switch while it had been opened
  // before (single mode included: switching to a different single profile,
  // not just an All-mode re-pick) would leave the ignore list reading and
  // writing this stale value forever after.
  const [pickedProfileId, setPickedProfileId] = useState<ProfileId>(
    () => scopeProfiles?.[0]?.profile.id ?? profileId
  );

  // The actual ignore-list bucket, re-derived every render: `pickedProfileId`
  // only wins while it is still a live member of `scopeProfiles`. The moment
  // it isn't - scopeProfiles is undefined (single mode, where this always
  // tracks the live `profileId` prop instead) or the previously-picked
  // profile dropped out of scope - it falls back to the current first scope
  // profile, or `profileId` in single mode.
  const ignoreTarget: ProfileId = scopeProfiles?.some((sp) => sp.profile.id === pickedProfileId)
    ? pickedProfileId
    : scopeProfiles?.[0]?.profile.id ?? profileId;

  const pickedRawSettings = useSettingsStore(
    useShallow((state) => state.profileSettings?.[ignoreTarget])
  );
  const pickedSettings = useMemo(() => mergeProfileSettings(pickedRawSettings), [pickedRawSettings]);

  const ignoredSet = useMemo(
    () => new Set(pickedSettings.liveActivityIgnoredMonitorIds),
    [pickedSettings.liveActivityIgnoredMonitorIds]
  );

  const ignoreListMonitors = scopeProfiles
    ? scopeProfiles.find((sp) => sp.profile.id === ignoreTarget)?.monitors ?? []
    : monitors;

  const pollField = useClampedNumberField(
    settings.liveActivityPollSeconds,
    LIVE_ACTIVITY.minPollSeconds,
    LIVE_ACTIVITY.maxPollSeconds,
    (clamped) =>
      useSettingsStore.getState().updateProfileSettings(profileId, { liveActivityPollSeconds: clamped })
  );

  const dwellField = useClampedNumberField(
    settings.liveActivityDwellSeconds,
    LIVE_ACTIVITY.minDwellSeconds,
    LIVE_ACTIVITY.maxDwellSeconds,
    (clamped) =>
      useSettingsStore.getState().updateProfileSettings(profileId, { liveActivityDwellSeconds: clamped })
  );

  const tilesField = useClampedNumberField(
    settings.liveActivityMaxTiles,
    LIVE_ACTIVITY.minTiles,
    LIVE_ACTIVITY.maxTiles,
    (clamped) =>
      useSettingsStore.getState().updateProfileSettings(profileId, { liveActivityMaxTiles: clamped })
  );

  const handleIgnoreToggle = (monitorId: string, watched: boolean) => {
    const current = pickedSettings.liveActivityIgnoredMonitorIds;
    const next = watched
      ? current.filter((id) => id !== monitorId)
      : current.includes(monitorId)
        ? current
        : [...current, monitorId];
    useSettingsStore.getState().updateProfileSettings(ignoreTarget, { liveActivityIgnoredMonitorIds: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="live-activity-settings-dialog">
        <DialogHeader>
          <DialogTitle>{t('live_activity.settings_title')}</DialogTitle>
          <DialogDescription>{t('live_activity.settings_desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="live-activity-poll">{t('live_activity.poll_interval_label')}</Label>
              {/* The unit rides beside the box because a number input cannot
                  hold text. aria-hidden: the field's own description already
                  says the value is in seconds, so announcing it again here
                  would only repeat it mid-value. */}
              <div className="flex items-center gap-1.5">
                <Input
                  id="live-activity-poll"
                  type="number"
                  min={LIVE_ACTIVITY.minPollSeconds}
                  max={LIVE_ACTIVITY.maxPollSeconds}
                  value={pollField.draft}
                  onChange={(e) => pollField.onChange(e.target.value)}
                  onFocus={pollField.onFocus}
                  onBlur={pollField.onBlur}
                  onKeyDown={pollField.onKeyDown}
                  className="w-20"
                  data-testid="live-activity-poll-input"
                />
                <span className="text-sm text-muted-foreground" aria-hidden="true">
                  {t('live_activity.unit_seconds')}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('live_activity.poll_interval_desc')}</p>
            <p className="text-xs text-muted-foreground">{t('live_activity.poll_bandwidth_note')}</p>
            {/* All mode only: the value typed above is floored while
                aggregating, and the floor is edited somewhere else entirely.
                Without this note the field silently reads as ignored. */}
            {scopeProfiles && scopeProfiles.length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="live-activity-all-mode-floor-note">
                {t('live_activity.all_mode_floor_note')}
              </p>
            )}
          </div>

          <Separator />

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="live-activity-dwell">{t('live_activity.dwell_label')}</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="live-activity-dwell"
                  type="number"
                  min={LIVE_ACTIVITY.minDwellSeconds}
                  max={LIVE_ACTIVITY.maxDwellSeconds}
                  value={dwellField.draft}
                  onChange={(e) => dwellField.onChange(e.target.value)}
                  onFocus={dwellField.onFocus}
                  onBlur={dwellField.onBlur}
                  onKeyDown={dwellField.onKeyDown}
                  className="w-20"
                  data-testid="live-activity-dwell-input"
                />
                <span className="text-sm text-muted-foreground" aria-hidden="true">
                  {t('live_activity.unit_seconds')}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('live_activity.dwell_desc')}</p>
          </div>

          <Separator />

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="live-activity-tiles">{t('live_activity.max_tiles_label')}</Label>
              <Input
                id="live-activity-tiles"
                type="number"
                min={LIVE_ACTIVITY.minTiles}
                max={LIVE_ACTIVITY.maxTiles}
                value={tilesField.draft}
                onChange={(e) => tilesField.onChange(e.target.value)}
                onFocus={tilesField.onFocus}
                onBlur={tilesField.onBlur}
                onKeyDown={tilesField.onKeyDown}
                className="w-20"
                data-testid="live-activity-tiles-input"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('live_activity.max_tiles_desc')}</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>{t('live_activity.ignore_list_label')}</Label>
              {scopeProfiles && scopeProfiles.length > 0 && (
                <ProfilePicker
                  profiles={scopeProfiles.map((sp) => sp.profile)}
                  value={ignoreTarget}
                  onChange={setPickedProfileId}
                  className="w-40 h-8"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('live_activity.ignore_list_desc')}</p>
            {ignoreListMonitors.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('live_activity.ignore_list_empty')}</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {ignoreListMonitors.map(({ Monitor }) => (
                  <div key={Monitor.Id} className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={`live-activity-ignore-${Monitor.Id}`}
                      className="text-sm font-normal truncate min-w-0"
                      title={Monitor.Name}
                    >
                      {Monitor.Name}
                    </Label>
                    <Switch
                      id={`live-activity-ignore-${Monitor.Id}`}
                      checked={!ignoredSet.has(Monitor.Id)}
                      onCheckedChange={(checked) => handleIgnoreToggle(Monitor.Id, checked)}
                      data-testid={`live-activity-ignore-${Monitor.Id}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
