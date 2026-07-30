/**
 * Live Activity Settings Dialog
 *
 * Poll interval, dwell window, tile cap, and a page-specific monitor ignore
 * list. The ignore list only stops a monitor pulling focus on this page; it
 * stays visible everywhere else. That is separate from the profile-wide
 * monitor exclusion (Settings > hidden monitors), which hides a monitor
 * everywhere.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { useSettingsStore, mergeProfileSettings } from '../../stores/settings';
import { LIVE_ACTIVITY } from '../../lib/zmninja-ng-constants';
import type { MonitorData } from '../../api/types';

export interface LiveActivitySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  monitors: MonitorData[];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Local text draft for a store-backed numeric field. Binding an <input>
 * straight to the committed store number makes it impossible to clear the
 * field: `Number('')` is 0, so every keystroke that passes through an empty
 * or partial value would clamp to the minimum and get redrawn into the input
 * mid-edit. This keeps the visible value as free-typed text and only commits
 * to the store once it parses to a real, finite number, clamped to bounds.
 * An empty or non-numeric draft is left uncommitted rather than clamped, so
 * the user can keep typing without the field snapping back.
 */
function useClampedNumberField(
  storedValue: number,
  min: number,
  max: number,
  onCommit: (clamped: number) => void
) {
  const [draft, setDraft] = useState(() => String(storedValue));

  // Resyncs the draft only when the committed store value actually changes
  // (our own commits below, or an external update), never on every render.
  useEffect(() => {
    setDraft(String(storedValue));
  }, [storedValue]);

  const onChange = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onCommit(clamp(parsed, min, max));
  };

  return { draft, onChange };
}

export function LiveActivitySettingsDialog({
  open,
  onOpenChange,
  profileId,
  monitors,
}: LiveActivitySettingsDialogProps) {
  const { t } = useTranslation();

  const rawSettings = useSettingsStore(
    useShallow((state) => state.profileSettings?.[profileId])
  );
  const settings = useMemo(() => mergeProfileSettings(rawSettings), [rawSettings]);

  const ignoredSet = useMemo(
    () => new Set(settings.liveActivityIgnoredMonitorIds),
    [settings.liveActivityIgnoredMonitorIds]
  );

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
    const current = settings.liveActivityIgnoredMonitorIds;
    const next = watched
      ? current.filter((id) => id !== monitorId)
      : current.includes(monitorId)
        ? current
        : [...current, monitorId];
    useSettingsStore.getState().updateProfileSettings(profileId, { liveActivityIgnoredMonitorIds: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="live-activity-settings-dialog">
        <DialogHeader>
          <DialogTitle>{t('live_activity.settings_title')}</DialogTitle>
          <DialogDescription>{t('live_activity.settings_desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="live-activity-poll">{t('live_activity.poll_interval_label')}</Label>
              <Input
                id="live-activity-poll"
                type="number"
                min={LIVE_ACTIVITY.minPollSeconds}
                max={LIVE_ACTIVITY.maxPollSeconds}
                value={pollField.draft}
                onChange={(e) => pollField.onChange(e.target.value)}
                className="w-24"
                data-testid="live-activity-poll-input"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('live_activity.poll_interval_desc')}</p>
            <p className="text-xs text-muted-foreground">{t('live_activity.poll_bandwidth_note')}</p>
          </div>

          <Separator />

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="live-activity-dwell">{t('live_activity.dwell_label')}</Label>
              <Input
                id="live-activity-dwell"
                type="number"
                min={LIVE_ACTIVITY.minDwellSeconds}
                max={LIVE_ACTIVITY.maxDwellSeconds}
                value={dwellField.draft}
                onChange={(e) => dwellField.onChange(e.target.value)}
                className="w-24"
                data-testid="live-activity-dwell-input"
              />
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
                className="w-24"
                data-testid="live-activity-tiles-input"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('live_activity.max_tiles_desc')}</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>{t('live_activity.ignore_list_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('live_activity.ignore_list_desc')}</p>
            {monitors.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('live_activity.ignore_list_empty')}</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {monitors.map(({ Monitor }) => (
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
