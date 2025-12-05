/**
 * Pull-to-Refresh Visual Indicator
 *
 * Displays visual feedback during pull-to-refresh gesture:
 * - Arrow icon that rotates as user pulls
 * - Spinning loader during refresh
 * - Smooth animations
 */

import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PullToRefreshIndicatorProps {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
  threshold: number;
}

export function PullToRefreshIndicator({
  isPulling,
  isRefreshing,
  pullDistance,
  threshold,
}: PullToRefreshIndicatorProps) {
  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 180;
  const opacity = Math.min(progress * 1.5, 1);

  if (!isPulling && !isRefreshing) return null;

  return (
    <div
      className={cn(
        'absolute top-0 left-0 right-0 flex items-center justify-center z-50 pointer-events-none',
        'transition-opacity duration-200'
      )}
      style={{ opacity }}
    >
      <div
        className={cn(
          'bg-background/95 backdrop-blur-sm rounded-full p-3 shadow-lg',
          'transition-transform duration-200',
          isRefreshing && 'scale-110'
        )}
        style={{
          transform: `translateY(${Math.min(pullDistance * 0.5, 60)}px)`,
        }}
      >
        <RefreshCw
          className={cn(
            'h-5 w-5 text-primary',
            isRefreshing && 'animate-spin'
          )}
          style={{
            transform: !isRefreshing ? `rotate(${rotation}deg)` : undefined,
          }}
        />
      </div>
    </div>
  );
}
