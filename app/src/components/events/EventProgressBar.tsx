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
import { EVENT_SCRUB_SEEK_DEBOUNCE_MS } from '../../lib/zmninja-ng-constants';

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
  // Local drag position: drives the handle, played-width, and counter while dragging,
  // so the handle follows the cursor immediately without waiting for a seek round-trip.
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);

  // Debounce timer for drag seeks (refs #196).
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest frame position seen during the current drag (updated on every move/down).
  const latestFrameRef = useRef<number>(0);
  // Last frame actually sent to onSeek (used for dedup).
  const lastSeekedFrameRef = useRef<number>(-1);

  // Drive handle, played-width, and counter from drag position during a drag.
  const displayFrame = isDragging && dragFrame != null ? dragFrame : currentFrame;
  const progress = (displayFrame / totalFrames) * 100;

  // Deduplicate + log + call onSeek. Returns without calling onSeek if the
  // frame is the same as the previous one, avoiding duplicate ZMS requests.
  const commit = useCallback((frame: number) => {
    if (frame === lastSeekedFrameRef.current) return;
    lastSeekedFrameRef.current = frame;
    log.eventProgressBar('Scrub target', LogLevel.DEBUG, {
      targetFrame: frame,
      totalFrames,
    });
    onSeek(frame);
  }, [onSeek, totalFrames]);

  // Compute the target frame from a clientX coordinate.
  const computeFrame = useCallback((clientX: number): number | null => {
    if (!progressRef.current) return null;
    const rect = progressRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const targetFrame = Math.round((percentage / 100) * totalFrames);
    return Math.max(1, Math.min(targetFrame, totalFrames));
  }, [totalFrames]);

  // Cancel any pending debounce timer and commit the frame immediately.
  // Used on mousedown/touchstart (initial click) and on release (exact landing).
  const flush = useCallback((frame: number) => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    commit(frame);
  }, [commit]);

  // Update the drag handle position immediately and (re)start the debounce timer.
  // Every move resets the timer, so continuous motion never triggers a seek.
  // When the timer fires (the user paused), it seeks to the latest known position.
  const handleDragMove = useCallback((clientX: number) => {
    const frame = computeFrame(clientX);
    if (frame === null) return;
    setDragFrame(frame);
    latestFrameRef.current = frame;

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      commit(latestFrameRef.current);
    }, EVENT_SCRUB_SEEK_DEBOUNCE_MS);
  }, [computeFrame, commit]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    onScrubStart?.();
    const frame = computeFrame(e.clientX);
    if (frame !== null) {
      setDragFrame(frame);
      latestFrameRef.current = frame;
      flush(frame);
    }
  }, [computeFrame, flush, onScrubStart]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    setIsDragging(true);
    onScrubStart?.();
    const frame = computeFrame(touch.clientX);
    if (frame !== null) {
      setDragFrame(frame);
      latestFrameRef.current = frame;
      flush(frame);
    }
  }, [computeFrame, flush, onScrubStart]);

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

  // Keyboard seeking: arrow keys step one frame, Home/End jump to the ends.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      flush(Math.max(1, displayFrame - 1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      flush(Math.min(totalFrames, displayFrame + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      flush(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      flush(totalFrames);
    }
  }, [displayFrame, totalFrames, flush]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => handleDragMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      // Stop the page from scrolling while dragging the scrubber.
      e.preventDefault();
      handleDragMove(touch.clientX);
    };
    const stop = () => {
      // Cancel debounce and seek to the exact release position.
      flush(latestFrameRef.current);
      setDragFrame(null);
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
  }, [isDragging, handleDragMove, flush, onScrubEnd]);

  // Clear the debounce timer on unmount to avoid a stale callback leak.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn('space-y-2', className)} data-testid="event-progress-bar">
      {/* Progress Bar */}
      <div
        ref={progressRef}
        className="relative h-8 bg-secondary/50 rounded-lg cursor-pointer overflow-hidden border border-border/50 hover:border-border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        role="slider"
        tabIndex={0}
        aria-label={t('events.seek_bar')}
        aria-valuemin={1}
        aria-valuemax={totalFrames}
        aria-valuenow={displayFrame}
        onMouseDown={handleMouseDown}
        onMouseMove={handleHover}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onKeyDown={handleKeyDown}
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
        <span data-testid="current-frame">{duration ? frameToTime(displayFrame) : t('events.frame_number', { number: displayFrame })}</span>
        <span data-testid="total-frames">{duration ? formatTime(duration) : t('events.total_frames', { count: totalFrames })}</span>
      </div>
    </div>
  );
}
