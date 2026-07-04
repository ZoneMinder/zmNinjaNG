/**
 * Video Markers Utility
 *
 * Utilities for calculating and generating video timeline markers from ZoneMinder event data.
 * Converts frame numbers to video timestamps for alarm frame visualization.
 */

import { log, LogLevel } from '../logger';
import type { Event } from '../../api/types';
import type { MarkerConfig, MarkersPlugin, MarkersPluginApi, MarkerTipConfig } from '../../types/videojs-markers';

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
 * A Video.js player as far as the markers plugin is concerned. ``player.markers``
 * is the plugin initializer function before init, and the plugin replaces it
 * with an API object (add/removeAll/...) after the first init.
 */
export interface VideoJsMarkersHost {
  markers: MarkersPlugin | MarkersPluginApi;
}

/**
 * Apply marker configs to the videojs-markers plugin on a player.
 *
 * videojs-markers (v1.x) registers via videojs.plugin(): inside the plugin
 * function the first statement is ``S = this; S.on('loadedmetadata', ...)``.
 * It must therefore be invoked as a method (``player.markers(opts)``) so ``this``
 * binds to the player. Calling it detached (``const f = player.markers; f(opts)``)
 * leaves ``this`` undefined and throws "Cannot read properties of undefined
 * (reading 'on')", which is what produced the recurring "Failed to update video
 * markers" errors for events that have markers.
 *
 * The plugin must be initialized exactly once per player; on init it replaces
 * ``player.markers`` with an API object, so a function value means "not yet
 * initialized". Initialization is deferred until there is at least one marker so
 * markerTip/onMarkerClick are wired up alongside real markers; later updates go
 * through removeAll()/add().
 *
 * @returns whether the plugin is initialized after this call
 */
export function applyVideoJsMarkers(
  player: VideoJsMarkersHost,
  markerConfigs: MarkerConfig[],
  initOptions: { markerTip: MarkerTipConfig; onMarkerClick: (marker: MarkerConfig) => void }
): boolean {
  if (typeof player.markers === 'function') {
    if (markerConfigs.length === 0) return false;
    // Method call: `this` binds to the player. Do not extract to a variable first.
    player.markers({ ...initOptions, markers: markerConfigs });
    return true;
  }

  player.markers.removeAll?.();
  if (markerConfigs.length > 0) {
    player.markers.add?.(markerConfigs);
  }
  return true;
}
