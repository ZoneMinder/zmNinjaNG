/**
 * The alarm state of a Live Activity tile, as an icon.
 *
 * The tile header is a 32px strip that already has to fit a status dot, a
 * truncated monitor name, and three buttons at 320px wide, so the state rides
 * as a glyph rather than as a word. An icon announces nothing on its own, so
 * it carries the same `live_activity.state_*` string it replaced as both its
 * accessible name and its hover title (refs #313).
 */

import { Bell, ShieldPlus, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { MonitorAlarmState } from '../../lib/monitor/alarm-state';

interface StateIconSpec {
  Icon: typeof Bell;
  labelKey: string;
  className: string;
}

/**
 * Three groups, six states.
 *
 * `prealarm` rides with `alert` rather than with the quiet states: both mean
 * ZoneMinder is part way into an alarm decision, so they read as the same
 * "something is starting or trailing off" to a user scanning the grid.
 *
 * `idle`, `tape`, and `unknown` all mean the monitor is resident but no
 * longer alarming, so it is winding down toward leaving the page. The shield
 * is the only signal that a tile is on its way out: cooling tiles are drawn
 * at full colour, identical to an active one, so nothing else distinguishes
 * them.
 */
const STATE_ICONS: Record<MonitorAlarmState, StateIconSpec> = {
  alarm: { Icon: Bell, labelKey: 'live_activity.state_alarm', className: 'text-red-500' },
  alert: { Icon: ShieldPlus, labelKey: 'live_activity.state_alert', className: 'text-amber-500' },
  prealarm: { Icon: ShieldPlus, labelKey: 'live_activity.state_alert', className: 'text-amber-500' },
  idle: { Icon: ShieldOff, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
  tape: { Icon: ShieldOff, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
  unknown: { Icon: ShieldOff, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
};

export function LiveActivityStateIcon({ state }: { state: MonitorAlarmState }) {
  const { t } = useTranslation();
  const { Icon, labelKey, className } = STATE_ICONS[state];
  const label = t(labelKey);

  // The name and the tooltip ride on a wrapping span rather than on the svg:
  // lucide's props type has no `title`, and a title attribute on an svg is not
  // a reliable hover tooltip anyway.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0"
      data-testid={`live-activity-state-${state}`}
    >
      <Icon className={cn('h-3.5 w-3.5', className)} aria-hidden="true" />
    </span>
  );
}
