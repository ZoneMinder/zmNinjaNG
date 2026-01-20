/**
 * Unit tests for zone-utils
 */

import { describe, it, expect } from 'vitest';
import {
  parseZoneCoords,
  getZoneColor,
  coordsToSvgPoints,
  alarmRGBToHex,
  transformPoint,
  coordsToSvgPointsWithTransform,
  getOrientedDimensions,
  type ZoneTransform,
} from '../zone-utils';
import type { MonitorRotation } from '../monitor-rotation';

describe('parseZoneCoords', () => {
  it('parses simple rectangle coords', () => {
    const coords = '0,0 100,0 100,100 0,100';
    const result = parseZoneCoords(coords);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it('parses coords from real ZoneMinder data', () => {
    const coords = '756,387 1551,513 1656,1970 696,1812';
    const result = parseZoneCoords(coords);
    expect(result).toEqual([
      { x: 756, y: 387 },
      { x: 1551, y: 513 },
      { x: 1656, y: 1970 },
      { x: 696, y: 1812 },
    ]);
  });

  it('handles extra whitespace', () => {
    const coords = '  0,0   100,0    100,100   0,100  ';
    const result = parseZoneCoords(coords);
    expect(result).toHaveLength(4);
  });

  it('returns empty array for empty string', () => {
    const result = parseZoneCoords('');
    expect(result).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(parseZoneCoords(null as unknown as string)).toEqual([]);
    expect(parseZoneCoords(undefined as unknown as string)).toEqual([]);
  });

  it('skips invalid coordinate pairs', () => {
    const coords = '0,0 invalid 100,100';
    const result = parseZoneCoords(coords);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
  });
});

describe('getZoneColor', () => {
  it('returns green for Active zones', () => {
    expect(getZoneColor('Active')).toBe('#22c55e');
  });

  it('returns blue for Inclusive zones', () => {
    expect(getZoneColor('Inclusive')).toBe('#3b82f6');
  });

  it('returns red for Exclusive zones', () => {
    expect(getZoneColor('Exclusive')).toBe('#ef4444');
  });

  it('returns yellow for Preclusive zones', () => {
    expect(getZoneColor('Preclusive')).toBe('#eab308');
  });

  it('returns gray for Inactive zones', () => {
    expect(getZoneColor('Inactive')).toBe('#6b7280');
  });

  it('returns black for Privacy zones', () => {
    expect(getZoneColor('Privacy')).toBe('#000000');
  });
});

describe('coordsToSvgPoints', () => {
  it('converts coords to SVG points string', () => {
    const coords = '0,0 100,0 100,100 0,100';
    const result = coordsToSvgPoints(coords);
    expect(result).toBe('0,0 100,0 100,100 0,100');
  });

  it('handles real ZoneMinder data', () => {
    const coords = '756,387 1551,513 1656,1970 696,1812';
    const result = coordsToSvgPoints(coords);
    expect(result).toBe('756,387 1551,513 1656,1970 696,1812');
  });

  it('returns empty string for empty input', () => {
    const result = coordsToSvgPoints('');
    expect(result).toBe('');
  });
});

describe('alarmRGBToHex', () => {
  it('converts red (16711680) to #ff0000', () => {
    expect(alarmRGBToHex(16711680)).toBe('#ff0000');
  });

  it('converts green (65280) to #00ff00', () => {
    expect(alarmRGBToHex(65280)).toBe('#00ff00');
  });

  it('converts blue (255) to #0000ff', () => {
    expect(alarmRGBToHex(255)).toBe('#0000ff');
  });

  it('converts white (16777215) to #ffffff', () => {
    expect(alarmRGBToHex(16777215)).toBe('#ffffff');
  });

  it('converts black (0) to #000000', () => {
    expect(alarmRGBToHex(0)).toBe('#000000');
  });

  it('returns undefined for undefined input', () => {
    expect(alarmRGBToHex(undefined)).toBeUndefined();
  });

  it('returns undefined for NaN', () => {
    expect(alarmRGBToHex(NaN)).toBeUndefined();
  });
});

describe('transformPoint', () => {
  const width = 1920;
  const height = 1080;

  it('returns point unchanged for no rotation', () => {
    const transform: ZoneTransform = {
      rotation: { kind: 'none' },
      originalWidth: width,
      originalHeight: height,
    };
    const result = transformPoint({ x: 100, y: 200 }, transform);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('transforms point for 90 degree rotation', () => {
    const transform: ZoneTransform = {
      rotation: { kind: 'degrees', degrees: 90 },
      originalWidth: width,
      originalHeight: height,
    };
    // (x, y) -> (y, width - x)
    const result = transformPoint({ x: 100, y: 200 }, transform);
    expect(result).toEqual({ x: 200, y: 1820 });
  });

  it('transforms point for 180 degree rotation', () => {
    const transform: ZoneTransform = {
      rotation: { kind: 'degrees', degrees: 180 },
      originalWidth: width,
      originalHeight: height,
    };
    // (x, y) -> (width - x, height - y)
    const result = transformPoint({ x: 100, y: 200 }, transform);
    expect(result).toEqual({ x: 1820, y: 880 });
  });

  it('transforms point for 270 degree rotation', () => {
    const transform: ZoneTransform = {
      rotation: { kind: 'degrees', degrees: 270 },
      originalWidth: width,
      originalHeight: height,
    };
    // (x, y) -> (height - y, x)
    const result = transformPoint({ x: 100, y: 200 }, transform);
    expect(result).toEqual({ x: 880, y: 100 });
  });

  it('returns point unchanged for flip rotation (handled by CSS)', () => {
    const transform: ZoneTransform = {
      rotation: { kind: 'flip_horizontal' },
      originalWidth: width,
      originalHeight: height,
    };
    const result = transformPoint({ x: 100, y: 200 }, transform);
    expect(result).toEqual({ x: 100, y: 200 });
  });
});

describe('coordsToSvgPointsWithTransform', () => {
  it('returns coords unchanged when no transform provided', () => {
    const coords = '0,0 100,0 100,100 0,100';
    const result = coordsToSvgPointsWithTransform(coords);
    expect(result).toBe('0,0 100,0 100,100 0,100');
  });

  it('transforms coords for 90 degree rotation', () => {
    const transform: ZoneTransform = {
      rotation: { kind: 'degrees', degrees: 90 },
      originalWidth: 100,
      originalHeight: 100,
    };
    // (x, y) -> (y, width - x) for 90 degrees
    // (0,0) -> (0, 100)
    // (100,0) -> (0, 0)
    // (100,100) -> (100, 0)
    // (0,100) -> (100, 100)
    const coords = '0,0 100,0 100,100 0,100';
    const result = coordsToSvgPointsWithTransform(coords, transform);
    expect(result).toBe('0,100 0,0 100,0 100,100');
  });
});

describe('getOrientedDimensions', () => {
  it('returns same dimensions for no rotation', () => {
    const rotation: MonitorRotation = { kind: 'none' };
    const result = getOrientedDimensions(1920, 1080, rotation);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('swaps dimensions for 90 degree rotation', () => {
    const rotation: MonitorRotation = { kind: 'degrees', degrees: 90 };
    const result = getOrientedDimensions(1920, 1080, rotation);
    expect(result).toEqual({ width: 1080, height: 1920 });
  });

  it('keeps same dimensions for 180 degree rotation', () => {
    const rotation: MonitorRotation = { kind: 'degrees', degrees: 180 };
    const result = getOrientedDimensions(1920, 1080, rotation);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('swaps dimensions for 270 degree rotation', () => {
    const rotation: MonitorRotation = { kind: 'degrees', degrees: 270 };
    const result = getOrientedDimensions(1920, 1080, rotation);
    expect(result).toEqual({ width: 1080, height: 1920 });
  });

  it('returns same dimensions for flip', () => {
    const rotation: MonitorRotation = { kind: 'flip_horizontal' };
    const result = getOrientedDimensions(1920, 1080, rotation);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });
});
