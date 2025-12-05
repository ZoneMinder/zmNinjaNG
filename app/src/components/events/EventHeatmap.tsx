/**
 * Event Timeline Heatmap Component
 *
 * Displays event density over time as a color-coded heatmap.
 * Features:
 * - Color gradient based on event density (low to high)
 * - Clickable bars to filter events by time range
 * - Responsive design with smart time bucketing
 * - Collapsible to save space
 * - Legend showing density scale
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { format, startOfHour, startOfDay, differenceInDays, addHours, addDays } from 'date-fns';
import type { EventData } from '../../api/types';

interface EventHeatmapProps {
  events: EventData[];
  startDate?: Date;
  endDate?: Date;
  onTimeRangeClick?: (startDateTime: string, endDateTime: string) => void;
  /** Whether the heatmap is collapsible (default: true). Set to false for widget mode. */
  collapsible?: boolean;
  /** Whether to show the card wrapper (default: true). Set to false for widget mode. */
  showCard?: boolean;
}

interface HeatmapBucket {
  time: Date;
  count: number;
  intensity: number; // 0-1
}

export function EventHeatmap({
  events,
  startDate,
  endDate,
  onTimeRangeClick,
  collapsible = true,
  showCard = true,
}: EventHeatmapProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(!collapsible);

  // Calculate time buckets and event density
  const { buckets } = useMemo(() => {
    if (!startDate || !endDate || events.length === 0) {
      return { buckets: [], maxCount: 0 };
    }

    const daysDiff = differenceInDays(endDate, startDate);

    // Determine bucket size based on time range
    const useDailyBuckets = daysDiff > 7;

    // Create buckets
    const bucketMap = new Map<string, number>();
    let current = useDailyBuckets ? startOfDay(startDate) : startOfHour(startDate);
    const end = useDailyBuckets ? startOfDay(endDate) : startOfHour(endDate);

    while (current <= end) {
      const key = current.toISOString();
      bucketMap.set(key, 0);
      current = useDailyBuckets ? addDays(current, 1) : addHours(current, 1);
    }

    // Count events in each bucket
    events.forEach((event) => {
      const eventTime = new Date(event.Event.StartDateTime);
      const bucketTime = useDailyBuckets ? startOfDay(eventTime) : startOfHour(eventTime);
      const key = bucketTime.toISOString();
      if (bucketMap.has(key)) {
        bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
      }
    });

    // Find max count for normalization
    const maxCount = Math.max(...Array.from(bucketMap.values()), 1);

    // Create bucket objects
    const buckets: HeatmapBucket[] = Array.from(bucketMap.entries()).map(([key, count]) => ({
      time: new Date(key),
      count,
      intensity: count / maxCount,
    }));

    return { buckets, maxCount };
  }, [events, startDate, endDate]);

  // Get color for intensity
  const getColor = (intensity: number): string => {
    if (intensity === 0) return 'rgb(226, 232, 240)'; // slate-200
    if (intensity < 0.2) return 'rgb(191, 219, 254)'; // blue-200
    if (intensity < 0.4) return 'rgb(147, 197, 253)'; // blue-300
    if (intensity < 0.6) return 'rgb(96, 165, 250)'; // blue-400
    if (intensity < 0.8) return 'rgb(59, 130, 246)'; // blue-500
    return 'rgb(37, 99, 235)'; // blue-600
  };

  // Format time label
  const formatTimeLabel = (time: Date, index: number): string => {
    const daysDiff = startDate && endDate ? differenceInDays(endDate, startDate) : 0;

    if (daysDiff > 7) {
      // Daily buckets: show date
      if (index % 7 === 0 || index === 0 || index === buckets.length - 1) {
        return format(time, 'MMM d');
      }
      return '';
    } else {
      // Hourly buckets: show time
      if (index % 4 === 0 || index === 0 || index === buckets.length - 1) {
        return format(time, 'HH:mm');
      }
      return '';
    }
  };

  const handleBarClick = (bucket: HeatmapBucket) => {
    if (!onTimeRangeClick) return;

    const daysDiff = startDate && endDate ? differenceInDays(endDate, startDate) : 0;
    const useDailyBuckets = daysDiff > 7;

    const rangeStart = bucket.time;
    const rangeEnd = useDailyBuckets ? addDays(bucket.time, 1) : addHours(bucket.time, 1);

    onTimeRangeClick(rangeStart.toISOString(), rangeEnd.toISOString());
  };

  if (buckets.length === 0) {
    return null;
  }

  const heatmapContent = (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t('events.heatmap_title', 'Event Density')}</h3>
          <span className="text-xs text-muted-foreground">
            ({t('events.heatmap_total', { count: events.length })})
          </span>
        </div>
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {isExpanded && (
        <>
          <div className="relative h-32 mb-3">
            <div className="flex items-end h-full gap-px">
              {buckets.map((bucket) => (
                <div
                  key={bucket.time.toISOString()}
                  className="relative group cursor-pointer transition-opacity hover:opacity-80 h-full"
                  style={{
                    flex: '1 1 0',
                    minWidth: showCard ? '8px' : '4px',
                    maxWidth: showCard ? 'none' : '20px'
                  }}
                  onClick={() => handleBarClick(bucket)}
                >
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${Math.max(bucket.intensity * 100, bucket.count > 0 ? 8 : 4)}%`,
                      backgroundColor: getColor(bucket.intensity),
                    }}
                  >
                    {/* Tooltip */}
                    {bucket.count > 0 && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {bucket.count} {t('events.heatmap_events', 'events')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* X-axis labels */}
          <div className="relative h-4 text-xs text-muted-foreground">
            <div className="relative">
              {buckets.map((bucket, bucketIndex) => {
                const label = formatTimeLabel(bucket.time, bucketIndex);
                if (!label) return null;
                const leftPercent = (bucketIndex / Math.max(buckets.length - 1, 1)) * 100;
                return (
                  <span
                    key={bucket.time.toISOString()}
                    className="absolute whitespace-nowrap text-[10px]"
                    style={{
                      left: `${leftPercent}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <span>{t('events.heatmap_low', 'Low')}</span>
            <div className="flex gap-1">
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity) => (
                <div
                  key={intensity}
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: getColor(intensity) }}
                />
              ))}
            </div>
            <span>{t('events.heatmap_high', 'High')}</span>
          </div>
        </>
      )}
    </>
  );

  if (showCard) {
    return <Card className="p-4 mb-4">{heatmapContent}</Card>;
  }

  return <div className="w-full h-full overflow-hidden">{heatmapContent}</div>;
}
