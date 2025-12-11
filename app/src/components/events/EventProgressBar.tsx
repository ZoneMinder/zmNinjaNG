/**
 * Event Progress Bar Component
 *
 * A visual progress bar for event playback that shows:
 * - Current playback position
 * - Alarm frame markers
 * - Click/drag to seek
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '../../lib/utils';

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
}

export function EventProgressBar({
  currentFrame,
  totalFrames,
  alarmFrames = [],
  onSeek,
  className,
}: EventProgressBarProps) {
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

    onSeek(Math.max(1, Math.min(targetFrame, totalFrames)));
  }, [totalFrames, onSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    handleSeek(e.clientX);
  }, [handleSeek]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      handleSeek(e.clientX);
    }
  }, [isDragging, handleSeek]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

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
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Progress Bar */}
      <div
        ref={progressRef}
        className="relative h-8 bg-secondary/50 rounded-lg cursor-pointer overflow-hidden border border-border/50 hover:border-border transition-colors"
        onMouseDown={handleMouseDown}
        onMouseMove={handleHover}
        onMouseLeave={handleMouseLeave}
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
            className="absolute inset-y-0 w-1 bg-destructive/80 hover:bg-destructive transition-colors"
            style={{ left: `${alarm.position}%` }}
            title={`Alarm Frame ${alarm.frameId}`}
          >
            {/* Top marker triangle */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-destructive" />
            {/* Bottom marker triangle */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-destructive" />
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
          >
            Frame {hoverPosition}
          </div>
        )}
      </div>

      {/* Frame counter */}
      <div className="flex justify-between text-xs text-muted-foreground px-1">
        <span>Frame {currentFrame}</span>
        <span>{totalFrames} frames</span>
      </div>
    </div>
  );
}
