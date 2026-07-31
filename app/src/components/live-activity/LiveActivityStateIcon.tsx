/**
 * The alarm state of a Live Activity tile, as an icon.
 *
 * The tile header is a 32px strip that already has to fit a status dot, a
 * truncated monitor name, and three buttons at 320px wide, so the state rides
 * as a glyph rather than as a word. An icon announces nothing on its own, so
 * it carries the same `live_activity.state_*` string it replaced as both its
 * accessible name and its hover title (refs #313).
 */

import { Siren, TriangleAlert, Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { MonitorAlarmState } from '../../lib/monitor/alarm-state';

interface StateIconSpec {
  Icon: typeof Siren;
  labelKey: string;
  className: string;
}

/**
 * Every state a resident tile can report. `idle`, `prealarm`, `tape`, and
 * `unknown` all mean the same thing here: the monitor is resident but no
 * longer alarming, so it is winding down toward leaving the page.
 */
const STATE_ICONS: Record<MonitorAlarmState, StateIconSpec> = {
  alarm: { Icon: Siren, labelKey: 'live_activity.state_alarm', className: 'text-red-500' },
  alert: { Icon: TriangleAlert, labelKey: 'live_activity.state_alert', className: 'text-amber-500' },
  idle: { Icon: Hourglass, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
  prealarm: { Icon: Hourglass, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
  tape: { Icon: Hourglass, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
  unknown: { Icon: Hourglass, labelKey: 'live_activity.state_cooling', className: 'text-muted-foreground' },
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
