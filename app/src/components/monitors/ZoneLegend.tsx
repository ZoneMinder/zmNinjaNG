/**
 * Zone Legend
 *
 * Small color key for the Show Zones overlay. Lists the zone types present on
 * the current monitor with their palette color and translated label.
 * Absolutely positioned within the player, non-interactive, shown only while
 * the overlay is visible.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Zone } from '../../api/types';
import { getZoneColor, ZONE_TYPE_ORDER } from '../../lib/zone-utils';

interface ZoneLegendProps {
  zones: Zone[];
  monitorId: string;
  visible: boolean;
  /** Position classes for the legend (default top-left). Set by the page so it
   *  clears the zoom controls (bottom-left) and the fullscreen bar (top). */
  positionClassName?: string;
}

export function ZoneLegend({ zones, monitorId, visible, positionClassName = 'top-2 left-2' }: ZoneLegendProps) {
  const { t } = useTranslation();

  const presentTypes = useMemo(() => {
    const present = new Set(
      zones
        .filter((zone) => String(zone.MonitorId) === String(monitorId))
        .map((zone) => zone.Type)
    );
    return ZONE_TYPE_ORDER.filter((type) => present.has(type));
  }, [zones, monitorId]);

  if (!visible || presentTypes.length === 0) {
    return null;
  }

  return (
    <div
      className={`absolute ${positionClassName} z-10 flex flex-col gap-1 rounded bg-black/60 px-2 py-1.5 pointer-events-none`}
      data-testid="zone-legend"
    >
      {presentTypes.map((type) => (
        <div
          key={type}
          className="flex items-center gap-1.5 min-w-0"
          data-testid={`zone-legend-row-${type}`}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: getZoneColor(type) }}
          />
          <span className="text-[10px] text-white/90 truncate min-w-0">
            {t(`monitor_detail.zone_type.${type.toLowerCase()}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
