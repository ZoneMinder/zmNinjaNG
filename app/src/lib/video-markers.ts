/**
 * Video Markers Utility
 *
 * Utilities for calculating and generating video timeline markers from ZoneMinder event data.
 * Converts frame numbers to video timestamps for alarm frame visualization.
 */

import { log } from './logger';
import type { Event } from '../api/types';

/**
 * Video marker for timeline visualization
 */
export interface VideoMarker {
  /** Timestamp in seconds where marker should appear */
  time: number;
  /** Tooltip text to display on hover */
  text?: string;
  /** Marker type for styling */
  type: 'alarm' | 'maxScore';
  /** Associated frame ID */
  frameId?: number;
}

/**
 * Convert frame number to video timestamp
 *
 * @param frameNumber - Frame number (1-indexed)
 * @param totalFrames - Total frames in event
 * @param eventLength - Event duration in seconds
 * @returns Timestamp in seconds, or null if invalid inputs
 *
 * @example
 * frameToTimestamp(50, 100, 10) // Returns 5.0 (halfway through 10s video)
 * frameToTimestamp(1, 100, 10)  // Returns 0.1 (first frame)
 */
export function frameToTimestamp(
  frameNumber: number,
  totalFrames: number,
  eventLength: number
): number | null {
  // Validate inputs
  if (!Number.isFinite(frameNumber) || frameNumber < 1) {
    log.warn('Invalid frame number', { component: 'VideoMarkers', frameNumber });
    return null;
  }

  if (!Number.isFinite(totalFrames) || totalFrames < 1) {
    log.warn('Invalid total frames', { component: 'VideoMarkers', totalFrames });
    return null;
  }

  if (!Number.isFinite(eventLength) || eventLength <= 0) {
    log.warn('Invalid event length', { component: 'VideoMarkers', eventLength });
    return null;
  }

  if (frameNumber > totalFrames) {
    log.warn('Frame number exceeds total frames', {
      component: 'VideoMarkers',
      frameNumber,
      totalFrames,
    });
    return null;
  }

  // Calculate timestamp: (eventLength / totalFrames) * frameNumber
  const timestamp = (eventLength / totalFrames) * frameNumber;

  return Math.max(0, Math.min(timestamp, eventLength)); // Clamp to valid range
}

/**
 * Generate video markers from ZoneMinder event data
 *
 * Creates markers for:
 * - Alarm frame (red marker)
 * - Max score frame (yellow marker, only if different from alarm frame)
 *
 * @param event - ZoneMinder event object
 * @returns Array of video markers (empty if invalid data)
 *
 * @example
 * const markers = generateEventMarkers(event);
 * // Returns: [
 * //   { time: 5.2, type: 'alarm', frameId: 52 },
 * //   { time: 7.8, type: 'maxScore', frameId: 78 }
 * // ]
 */
export function generateEventMarkers(event: Event | null | undefined): VideoMarker[] {
  if (!event) {
    log.debug('No event data provided for markers', { component: 'VideoMarkers' });
    return [];
  }

  const markers: VideoMarker[] = [];

  // Extract event data
  const totalFrames = Number(event.Frames);
  const eventLength = parseFloat(event.Length);
  const alarmFrameId = event.AlarmFrameId ? Number(event.AlarmFrameId) : null;
  const maxScoreFrameId = event.MaxScoreFrameId ? Number(event.MaxScoreFrameId) : null;

  // Validate required data
  if (!Number.isFinite(totalFrames) || totalFrames < 1) {
    log.warn('Invalid or missing total frames in event', {
      component: 'VideoMarkers',
      eventId: event.Id,
      frames: event.Frames,
    });
    return [];
  }

  if (!Number.isFinite(eventLength) || eventLength <= 0) {
    log.warn('Invalid or missing event length', {
      component: 'VideoMarkers',
      eventId: event.Id,
      length: event.Length,
    });
    return [];
  }

  // Add alarm frame marker (red)
  if (alarmFrameId && Number.isFinite(alarmFrameId)) {
    const alarmTime = frameToTimestamp(alarmFrameId, totalFrames, eventLength);

    if (alarmTime !== null) {
      markers.push({
        time: alarmTime,
        type: 'alarm',
        frameId: alarmFrameId,
      });

      log.debug('Added alarm frame marker', {
        component: 'VideoMarkers',
        frameId: alarmFrameId,
        time: alarmTime,
      });
    }
  }

  // Add max score marker (yellow) - only if different from alarm frame
  if (
    maxScoreFrameId &&
    Number.isFinite(maxScoreFrameId) &&
    maxScoreFrameId !== alarmFrameId
  ) {
    const maxScoreTime = frameToTimestamp(maxScoreFrameId, totalFrames, eventLength);

    if (maxScoreTime !== null) {
      markers.push({
        time: maxScoreTime,
        type: 'maxScore',
        frameId: maxScoreFrameId,
      });

      log.debug('Added max score frame marker', {
        component: 'VideoMarkers',
        frameId: maxScoreFrameId,
        time: maxScoreTime,
      });
    }
  }

  if (markers.length > 0) {
    log.info('Generated video markers', {
      component: 'VideoMarkers',
      eventId: event.Id,
      count: markers.length,
    });
  }

  return markers;
}
