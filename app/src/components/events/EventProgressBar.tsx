/**
 * Event Progress Bar Component
 *
 * A visual progress bar for event playback that shows:
 * - Current playback position
 * - Alarm frame markers
 * - Click/drag to seek
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { log, LogLevel } from '../../lib/logger';

interface AlarmFrame {
  frameId: number;
  position: number; // 0-100 percentage
}

interface EventProgressBarProps {
  currentFrame: number;
  totalFrames: number;
  alarmFrames?: AlarmFrame[];
  onSeek: (frame: number) => void;
  className?: string;
  /** Event duration in seconds. When provided, displays time instead of frame numbers. */
  duration?: number;
  /** Fired when a scrub gesture begins (mouse/touch down on the track). */
  onScrubStart?: () => void;
  /** Fired when a scrub gesture ends (pointer release or cancel). */
  onScrubEnd?: () => void;
}

export function EventProgressBar({
  currentFrame,
  totalFrames,
  alarmFrames = [],
  onSeek,
  className,
  duration,
  onScrubStart,
  onScrubEnd,
}: EventProgressBarProps) {
  const { t } = useTranslation();

  const formatTime = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  const frameToTime = useCallback((frame: number) => {
    if (!duration || totalFrames <= 0) return '';
    return formatTime((frame / totalFrames) * duration);
  }, [duration, totalFrames, formatTime]);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);

  const progress = (currentFrame / totalFrames) * 100;

  const handleSeek = useCallback((clientX: number) => {
    if (!progressRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const targetFrame = Math.round((percentage / 100) * totalFrames);
    const clampedFrame = Math.max(1, Math.min(targetFrame, totalFrames));

    log.eventProgressBar('Scrub target', LogLevel.DEBUG, {
      percentage: Math.round(percentage * 10) / 10,
      targetFrame: clampedFrame,
      totalFrames,
    });

    onSeek(clampedFrame);
  }, [totalFrames, onSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    onScrubStart?.();
    handleSeek(e.clientX);
  }, [handleSeek, onScrubStart]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    setIsDragging(true);
    onScrubStart?.();
    handleSeek(touch.clientX);
  }, [handleSeek, onScrubStart]);

  const handleHover = useCallback((e: React.MouseEvent) => {
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const frame = Math.round((percentage / 100) * totalFrames);
    setHoverPosition(frame);
  }, [totalFrames]);

  const handleMouseLeave = useCallback(() => {
    setHoverPosition(null);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => handleSeek(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      // Stop the page from scrolling while dragging the scrubber.
      e.preventDefault();
      handleSeek(touch.clientX);
    };
    const stop = () => {
      setIsDragging(false);
      onScrubEnd?.();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', stop);
    window.addEventListener('touchcancel', stop);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stop);
      window.removeEventListener('touchcancel', stop);
    };
  }, [isDragging, handleSeek, onScrubEnd]);

  return (
    <div className={cn('space-y-2', className)} data-testid="event-progress-bar">
      {/* Progress Bar */}
      <div
        ref={progressRef}
        className="relative h-8 bg-secondary/50 rounded-lg cursor-pointer overflow-hidden border border-border/50 hover:border-border transition-colors"
        onMouseDown={handleMouseDown}
        onMouseMove={handleHover}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        data-testid="event-progress-track"
      >
        {/* Background grid lines for visual reference */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 border-r border-border/20 last:border-r-0"
            />
          ))}
        </div>

        {/* Played progress */}
        <div
          className="absolute inset-y-0 left-0 bg-primary/30 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />

        {/* Alarm frame markers */}
        {alarmFrames.map((alarm, index) => (
          <div
            key={`alarm-${alarm.frameId}-${index}`}
            className="group absolute inset-y-0 w-0"
            style={{ left: `${alarm.position}%` }}
            title={t('events.alarm_frame', { frameId: alarm.frameId })}
            data-testid={`alarm-marker-${alarm.frameId}`}
          >
            <div className="absolute top-1/2 left-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive/80 shadow-sm ring-1 ring-destructive/40 transition-colors group-hover:bg-destructive group-hover:ring-destructive" />
          </div>
        ))}

        {/* Current position indicator */}
        <div
          className="absolute inset-y-0 w-0.5 bg-primary shadow-lg transition-all duration-100"
          style={{ left: `${progress}%` }}
        >
          {/* Playhead handle */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full border-2 border-background shadow-md" />
        </div>

        {/* Hover indicator */}
        {hoverPosition !== null && !isDragging && (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/30 pointer-events-none"
            style={{ left: `${(hoverPosition / totalFrames) * 100}%` }}
          />
        )}

        {/* Frame number tooltip on hover */}
        {hoverPosition !== null && (
          <div
            className="absolute -top-8 transform -translate-x-1/2 bg-popover text-popover-foreground px-2 py-1 rounded text-xs font-medium shadow-lg border border-border pointer-events-none whitespace-nowrap"
            style={{ left: `${(hoverPosition / totalFrames) * 100}%` }}
            data-testid="hover-tooltip"
          >
            {duration ? frameToTime(hoverPosition) : t('events.frame_number', { number: hoverPosition })}
          </div>
        )}
      </div>

      {/* Time / Frame counter */}
      <div className="flex justify-between text-xs text-muted-foreground px-1" data-testid="frame-counter">
        <span data-testid="current-frame">{duration ? frameToTime(currentFrame) : t('events.frame_number', { number: currentFrame })}</span>
        <span data-testid="total-frames">{duration ? formatTime(duration) : t('events.total_frames', { count: totalFrames })}</span>
      </div>
    </div>
  );
}
