/**
 * Zone Utilities
 *
 * Utilities for parsing and rendering zone data from ZoneMinder.
 */

import type { ZoneType } from '../api/types';
import type { MonitorRotation } from './monitor-rotation';

/**
 * Represents a coordinate point.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Transformation parameters for rotating zone coordinates.
 */
export interface ZoneTransform {
  rotation: MonitorRotation;
  originalWidth: number;
  originalHeight: number;
}

/**
 * Zone color configuration based on type.
 * Uses Tailwind color values.
 */
const zoneColors: Record<ZoneType, string> = {
  Active: '#22c55e',     // green-500
  Inclusive: '#3b82f6',  // blue-500
  Exclusive: '#ef4444',  // red-500
  Preclusive: '#eab308', // yellow-500
  Inactive: '#6b7280',   // gray-500
  Privacy: '#000000',    // black
};

/**
 * Parses zone coordinates from ZoneMinder format.
 * Format: "x,y x,y x,y x,y" (space-separated coordinate pairs)
 *
 * @param coords - The coordinate string from ZoneMinder
 * @returns Array of Point objects, or empty array if parsing fails
 */
export function parseZoneCoords(coords: string): Point[] {
  if (!coords || typeof coords !== 'string') {
    return [];
  }

  const points: Point[] = [];
  const pairs = coords.trim().split(/\s+/);

  for (const pair of pairs) {
    const [xStr, yStr] = pair.split(',');
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y });
    }
  }

  return points;
}

/**
 * Returns the color for a zone type.
 *
 * @param type - The zone type
 * @returns Hex color string
 */
export function getZoneColor(type: ZoneType): string {
  return zoneColors[type] || '#6b7280'; // Default to gray
}

/**
 * Converts zone coordinates to SVG polygon points string.
 *
 * @param coords - The coordinate string from ZoneMinder
 * @returns SVG points string (e.g., "0,0 100,0 100,100 0,100")
 */
export function coordsToSvgPoints(coords: string): string {
  const points = parseZoneCoords(coords);
  return points.map(p => `${p.x},${p.y}`).join(' ');
}

/**
 * Converts AlarmRGB integer to hex color string.
 * ZoneMinder stores RGB as a single integer (R*65536 + G*256 + B).
 *
 * @param alarmRGB - The AlarmRGB integer value
 * @returns Hex color string (e.g., "#ff0000")
 */
export function alarmRGBToHex(alarmRGB: number | undefined): string | undefined {
  if (alarmRGB === undefined || !Number.isFinite(alarmRGB)) {
    return undefined;
  }

  // Extract RGB components
  const r = (alarmRGB >> 16) & 0xff;
  const g = (alarmRGB >> 8) & 0xff;
  const b = alarmRGB & 0xff;

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Transforms a single point based on rotation.
 * Zone coordinates are stored in the original (unrotated) coordinate space.
 * This transforms them to match the rotated display.
 *
 * Rotation transformations:
 * - 90 degrees: (x, y) -> (y, width - x)
 * - 180 degrees: (x, y) -> (width - x, height - y)
 * - 270 degrees: (x, y) -> (height - y, x)
 *
 * @param point - The point to transform
 * @param transform - The transformation parameters
 * @returns The transformed point
 */
export function transformPoint(point: Point, transform: ZoneTransform): Point {
  const { rotation, originalWidth, originalHeight } = transform;

  if (rotation.kind !== 'degrees') {
    // No rotation or flip - return unchanged
    // Note: flips are handled by CSS transform, not coordinate transformation
    return point;
  }

  // Normalize rotation to 0, 90, 180, 270
  const degrees = ((rotation.degrees % 360) + 360) % 360;

  switch (degrees) {
    case 90:
      // (x, y) -> (y, width - x)
      return { x: point.y, y: originalWidth - point.x };
    case 180:
      // (x, y) -> (width - x, height - y)
      return { x: originalWidth - point.x, y: originalHeight - point.y };
    case 270:
      // (x, y) -> (height - y, x)
      return { x: originalHeight - point.y, y: point.x };
    default:
      return point;
  }
}

/**
 * Converts zone coordinates to SVG polygon points string with optional rotation transformation.
 *
 * @param coords - The coordinate string from ZoneMinder
 * @param transform - Optional transformation to apply (rotation)
 * @returns SVG points string (e.g., "0,0 100,0 100,100 0,100")
 */
export function coordsToSvgPointsWithTransform(coords: string, transform?: ZoneTransform): string {
  const points = parseZoneCoords(coords);

  if (!transform) {
    return points.map(p => `${p.x},${p.y}`).join(' ');
  }

  const transformedPoints = points.map(p => transformPoint(p, transform));
  return transformedPoints.map(p => `${p.x},${p.y}`).join(' ');
}

/**
 * Gets the oriented dimensions after applying rotation.
 * For 90 and 270 degree rotations, width and height are swapped.
 *
 * @param width - Original width
 * @param height - Original height
 * @param rotation - The rotation to apply
 * @returns Object with oriented width and height
 */
export function getOrientedDimensions(
  width: number,
  height: number,
  rotation: MonitorRotation
): { width: number; height: number } {
  if (rotation.kind === 'degrees') {
    const degrees = ((rotation.degrees % 360) + 360) % 360;
    if (degrees === 90 || degrees === 270) {
      return { width: height, height: width };
    }
  }
  return { width, height };
}
