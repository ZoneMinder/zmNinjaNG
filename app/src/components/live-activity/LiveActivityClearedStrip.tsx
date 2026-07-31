/**
 * What left the grid in the last few minutes.
 *
 * The page otherwise only ever shows "now", so a camera that alarmed while
 * nobody was looking vanishes without trace. This is the small, static answer
 * to that: names and how long ago, no players, nothing live. Mounting tiles
 * here would reopen the very streams the dwell window just closed.
 */

import { useTranslation } from 'react-i18next';
import { formatElapsedShort } from '../../lib/format-date-time';

export interface ClearedStripItem {
  monitorId: string;
  name: string;
  clearedAt: number;
}

interface LiveActivityClearedStripProps {
  items: ClearedStripItem[];
  /** The page's one-second clock, shared with the tiles' elapsed labels. */
  now: number;
}

export function LiveActivityClearedStrip({ items, now }: LiveActivityClearedStripProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-1.5"
      data-testid="live-activity-cleared"
    >
      <span className="text-xs text-muted-foreground shrink-0">
        {t('live_activity.recently_cleared')}
      </span>
      {items.map((item) => (
        <span
          key={item.monitorId}
          className="min-w-0 max-w-full truncate rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
          title={item.name}
          data-testid={`live-activity-cleared-${item.monitorId}`}
        >
          {item.name} {formatElapsedShort(now - item.clearedAt)}
        </span>
      ))}
    </div>
  );
}
