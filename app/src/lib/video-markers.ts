/**
 * Video Markers Utility
 *
 * Utilities for calculating and generating video timeline markers from ZoneMinder event data.
 * Converts frame numbers to video timestamps for alarm frame visualization.
 */

import { log, LogLevel } from './logger';
import type { Event } from '../api/types';
import type { MarkerConfig, MarkersPlugin, MarkerTipConfig } from '../types/videojs-markers';

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
    log.videoMarkers('Invalid frame number', LogLevel.WARN, { frameNumber });
    return null;
  }

  if (!Number.isFinite(totalFrames) || totalFrames < 1) {
    log.videoMarkers('Invalid total frames', LogLevel.WARN, { totalFrames });
    return null;
  }

  if (!Number.isFinite(eventLength) || eventLength <= 0) {
    log.videoMarkers('Invalid event length', LogLevel.WARN, { eventLength });
    return null;
  }

  if (frameNumber > totalFrames) {
    log.videoMarkers('Frame number exceeds total frames', LogLevel.WARN, { frameNumber,
      totalFrames, });
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
    log.videoMarkers('No event data provided for markers', LogLevel.DEBUG);
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
    log.videoMarkers('Invalid or missing total frames in event', LogLevel.WARN, { eventId: event.Id,
      frames: event.Frames, });
    return [];
  }

  if (!Number.isFinite(eventLength) || eventLength <= 0) {
    log.videoMarkers('Invalid or missing event length', LogLevel.WARN, { eventId: event.Id,
      length: event.Length, });
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

      log.videoMarkers('Added alarm frame marker', LogLevel.DEBUG, { frameId: alarmFrameId,
        time: alarmTime, });
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

      log.videoMarkers('Added max score frame marker', LogLevel.DEBUG, { frameId: maxScoreFrameId,
        time: maxScoreTime, });
    }
  }

  if (markers.length > 0) {
    log.videoMarkers('Generated video markers', LogLevel.INFO, { eventId: event.Id,
      count: markers.length, });
  }

  return markers;
}

/**
 * Apply marker configs to a videojs-markers plugin instance.
 *
 * videojs-markers is a Video.js basic plugin: calling the plugin function
 * initializes it. It must be called exactly once per player. Re-invoking it
 * re-runs initialization (duplicate timeupdate handlers and DOM) and throws,
 * which surfaced as repeated "Failed to update video markers" errors whenever
 * a react-query refetch produced a new markers array. After the first init,
 * updates must go through removeAll()/add().
 *
 * Initialization is deferred until there is at least one marker so the
 * markerTip and onMarkerClick options are wired up alongside real markers.
 *
 * @param markersFn - the plugin attached to the player (player.markers)
 * @param markerConfigs - markers to display
 * @param alreadyInitialized - whether the plugin was initialized for this player
 * @param initOptions - options passed only on the first (initializing) call
 * @returns whether the plugin is initialized after this call (true once it has been)
 */
export function applyVideoJsMarkers(
  markersFn: MarkersPlugin,
  markerConfigs: MarkerConfig[],
  alreadyInitialized: boolean,
  initOptions: { markerTip: MarkerTipConfig; onMarkerClick: (marker: MarkerConfig) => void }
): boolean {
  if (!alreadyInitialized) {
    if (markerConfigs.length === 0) return false;
    markersFn({ ...initOptions, markers: markerConfigs });
    return true;
  }

  markersFn.removeAll?.();
  if (markerConfigs.length > 0) {
    markersFn.add?.(markerConfigs);
  }
  return true;
}
