/**
 * Live Activity Settings Dialog
 *
 * Poll interval, dwell window, tile cap, and a page-specific monitor ignore
 * list. The ignore list only stops a monitor pulling focus on this page; it
 * stays visible everywhere else. That is separate from the profile-wide
 * monitor exclusion (Settings > hidden monitors), which hides a monitor
 * everywhere.
 *
 * A monitor that records continuously is skipped by default, so its toggle
 * drives a separate opt-in list instead of the ignore list: that keeps the
 * automatic default distinguishable from a monitor the user turned off.
 */

import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { useSettingsStore, mergeProfileSettings } from '../../stores/settings';
import { useAuthStore } from '../../stores/auth';
import { isContinuousRecording } from '../../lib/monitor/monitor-status';
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
 * Local text draft for a store-backed numeric field, committed on blur (or
 * Enter) instead of on every keystroke.
 *
 * Committing on every `onChange` has two problems. Binding the input straight
 * to the committed store number makes it impossible to clear: `Number('')` is
 * 0, so an empty or partial value would clamp to the minimum and redraw into
 * the input mid-edit. Committing a clamped value on every keystroke is also
 * self-defeating even with a local draft: the commit changes `storedValue`,
 * which resyncs the draft to the clamped string, so the NEXT keystroke
 * appends to that clamped string instead of what the user actually typed
 * (typing "12" one digit at a time: "1" commits and clamps to the minimum
 * "2", the draft resyncs to "2", and the next keystroke produces "22").
 *
 * Committing only on blur/Enter removes the loop entirely: `onChange` only
 * ever touches local state, so `storedValue` cannot change mid-edit and the
 * resync below cannot fire while the user is still typing.
 *
 * Deliberate policy for a genuine conflict, an external write landing while
 * the field has focus: the user's in-progress edit wins. `lastStoredValue`
 * (the last external value actually applied to the draft) is only advanced
 * together with applying it, never on its own, so a `storedValue` change
 * that arrives while focused leaves `lastStoredValue` stale rather than
 * marking that value as seen without ever showing it. On blur, `commit()`
 * writes whatever the user typed, superseding the value that arrived
 * mid-edit; the render right after that commit then sees its own new
 * `storedValue` differ from the still-stale `lastStoredValue` and applies
 * it (a no-op here, since it already matches the just-typed draft). Because
 * the two pieces of state always advance together, a field can never end up
 * permanently desynced: any external write that arrived mid-edit and was
 * superseded, or one that lands after the field is unfocused, is picked up
 * the next time this runs unfocused.
 *
 * The resync itself runs during render rather than in a `useEffect`, per
 * React's documented pattern for "adjusting state when a prop changes"
 * (comparing against the last-seen prop value in state and calling
 * `setState` inline): it updates the draft before the browser paints the
 * stale value, where an effect-based resync would paint once with the old
 * draft and then again with the corrected one. Focus tracking uses state
 * rather than a ref for the same reason: the render-time guard below needs
 * to read it, and reading a ref during render is unsafe.
 */
function useClampedNumberField(
  storedValue: number,
  min: number,
  max: number,
  onCommit: (clamped: number) => void
) {
  const [draft, setDraft] = useState(() => String(storedValue));
  const [lastStoredValue, setLastStoredValue] = useState(storedValue);
  const [isFocused, setIsFocused] = useState(false);

  // Both pieces of state advance together, and only while unfocused: never
  // mark a value as seen (lastStoredValue) without also applying it (draft).
  if (storedValue !== lastStoredValue && !isFocused) {
    setLastStoredValue(storedValue);
    setDraft(String(storedValue));
  }

  const onChange = (raw: string) => {
    setDraft(raw);
  };

  const onFocus = () => {
    setIsFocused(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    const clamped =
      trimmed === '' || !Number.isFinite(parsed) ? storedValue : clamp(parsed, min, max);
    setDraft(String(clamped));
    if (clamped !== storedValue) onCommit(clamped);
  };

  const onBlur = () => {
    setIsFocused(false);
    commit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };

  return { draft, onChange, onFocus, onBlur, onKeyDown };
}

export function LiveActivitySettingsDialog({
  open,
  onOpenChange,
  profileId,
  monitors,
}: LiveActivitySettingsDialogProps) {
  const { t } = useTranslation();
  const zmVersion = useAuthStore((s) => s.version);

  const rawSettings = useSettingsStore(
    useShallow((state) => state.profileSettings?.[profileId])
  );
  const settings = useMemo(() => mergeProfileSettings(rawSettings), [rawSettings]);

  const ignoredSet = useMemo(
    () => new Set(settings.liveActivityIgnoredMonitorIds),
    [settings.liveActivityIgnoredMonitorIds]
  );

  const watchContinuousSet = useMemo(
    () => new Set(settings.liveActivityWatchContinuousIds),
    [settings.liveActivityWatchContinuousIds]
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

  // A continuous recorder is off by default, so its toggle drives the opt-in
  // list instead: on means watched, which is the inverse of the ignore list.
  const handleContinuousToggle = (monitorId: string, watched: boolean) => {
    const current = settings.liveActivityWatchContinuousIds;
    const next = watched
      ? current.includes(monitorId)
        ? current
        : [...current, monitorId]
      : current.filter((id) => id !== monitorId);
    useSettingsStore.getState().updateProfileSettings(profileId, { liveActivityWatchContinuousIds: next });
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
                onFocus={pollField.onFocus}
                onBlur={pollField.onBlur}
                onKeyDown={pollField.onKeyDown}
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
                onFocus={dwellField.onFocus}
                onBlur={dwellField.onBlur}
                onKeyDown={dwellField.onKeyDown}
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
                onFocus={tilesField.onFocus}
                onBlur={tilesField.onBlur}
                onKeyDown={tilesField.onKeyDown}
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
                {monitors.map(({ Monitor }) => {
                  const continuous = isContinuousRecording(Monitor, zmVersion);
                  return (
                    <div key={Monitor.Id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Label
                          htmlFor={`live-activity-ignore-${Monitor.Id}`}
                          className="text-sm font-normal truncate min-w-0 block"
                          title={Monitor.Name}
                        >
                          {Monitor.Name}
                        </Label>
                        {continuous && (
                          <p
                            className="text-xs text-muted-foreground"
                            data-testid={`live-activity-continuous-hint-${Monitor.Id}`}
                          >
                            {t('live_activity.continuous_hint')}
                          </p>
                        )}
                      </div>
                      <Switch
                        id={`live-activity-ignore-${Monitor.Id}`}
                        checked={
                          continuous
                            ? watchContinuousSet.has(Monitor.Id)
                            : !ignoredSet.has(Monitor.Id)
                        }
                        onCheckedChange={(checked) =>
                          continuous
                            ? handleContinuousToggle(Monitor.Id, checked)
                            : handleIgnoreToggle(Monitor.Id, checked)
                        }
                        data-testid={`live-activity-ignore-${Monitor.Id}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
