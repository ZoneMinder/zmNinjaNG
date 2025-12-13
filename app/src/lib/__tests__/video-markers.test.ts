/**
 * Unit tests for video-markers utility
 */

import { describe, it, expect } from 'vitest';
import { frameToTimestamp, generateEventMarkers } from '../video-markers';
import type { Event } from '../../api/types';

describe('frameToTimestamp', () => {
  it('calculates timestamp for middle frame', () => {
    const result = frameToTimestamp(50, 100, 10);
    expect(result).toBe(5.0);
  });

  it('calculates timestamp for first frame', () => {
    const result = frameToTimestamp(1, 100, 10);
    expect(result).toBe(0.1);
  });

  it('calculates timestamp for last frame', () => {
    const result = frameToTimestamp(100, 100, 10);
    expect(result).toBe(10.0);
  });

  it('returns null for invalid frame number (< 1)', () => {
    const result = frameToTimestamp(0, 100, 10);
    expect(result).toBeNull();
  });

  it('returns null for invalid frame number (negative)', () => {
    const result = frameToTimestamp(-5, 100, 10);
    expect(result).toBeNull();
  });

  it('returns null for invalid frame number (NaN)', () => {
    const result = frameToTimestamp(NaN, 100, 10);
    expect(result).toBeNull();
  });

  it('returns null for invalid total frames (< 1)', () => {
    const result = frameToTimestamp(50, 0, 10);
    expect(result).toBeNull();
  });

  it('returns null for invalid total frames (NaN)', () => {
    const result = frameToTimestamp(50, NaN, 10);
    expect(result).toBeNull();
  });

  it('returns null for invalid event length (zero)', () => {
    const result = frameToTimestamp(50, 100, 0);
    expect(result).toBeNull();
  });

  it('returns null for invalid event length (negative)', () => {
    const result = frameToTimestamp(50, 100, -5);
    expect(result).toBeNull();
  });

  it('returns null for invalid event length (NaN)', () => {
    const result = frameToTimestamp(50, 100, NaN);
    expect(result).toBeNull();
  });

  it('returns null when frame number exceeds total frames', () => {
    const result = frameToTimestamp(150, 100, 10);
    expect(result).toBeNull();
  });

  it('clamps timestamp to event length', () => {
    // Even if calculation exceeds length, should clamp to max
    const result = frameToTimestamp(100, 100, 10);
    expect(result).toBe(10);
  });

  it('clamps timestamp to zero minimum', () => {
    // Should never return negative timestamp
    const result = frameToTimestamp(1, 100, 10);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('handles fractional seconds correctly', () => {
    const result = frameToTimestamp(33, 100, 10);
    expect(result).toBeCloseTo(3.3, 10);
  });
});

describe('generateEventMarkers', () => {
  // Helper to create mock event with required fields
  const createMockEvent = (overrides: Partial<Event> = {}): Event => ({
    Id: '123',
    MonitorId: '1',
    StorageId: null,
    SecondaryStorageId: null,
    Name: 'Test Event',
    Cause: 'Motion',
    StartDateTime: '2025-01-01 00:00:00',
    EndDateTime: '2025-01-01 00:00:10',
    Width: '1920',
    Height: '1080',
    Length: '10.0',
    Frames: '100',
    AlarmFrames: '5',
    AlarmFrameId: '50',
    MaxScoreFrameId: '50',
    DefaultVideo: 'test.mp4',
    SaveJPEGs: '1',
    TotScore: '100',
    AvgScore: '20',
    MaxScore: '50',
    Archived: '0',
    Videoed: '1',
    Uploaded: '0',
    Emailed: '0',
    Messaged: '0',
    Executed: '0',
    Notes: null,
    StateId: null,
    Orientation: null,
    DiskSpace: '1024',
    Scheme: 'medium',
    ...overrides,
  });

  it('generates alarm frame marker', () => {
    const mockEvent = createMockEvent();

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      time: 5.0,
      type: 'alarm',
      frameId: 50,
    });
  });

  it('generates both alarm and max score markers when different', () => {
    const mockEvent = createMockEvent({
      AlarmFrameId: '30',
      MaxScoreFrameId: '70',
    });

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(2);

    const alarmMarker = markers.find(m => m.type === 'alarm');
    const maxScoreMarker = markers.find(m => m.type === 'maxScore');

    expect(alarmMarker).toMatchObject({
      time: 3.0,
      type: 'alarm',
      frameId: 30,
    });

    expect(maxScoreMarker).toMatchObject({
      time: 7.0,
      type: 'maxScore',
      frameId: 70,
    });
  });

  it('generates only one marker when alarm and max score are same frame', () => {
    const mockEvent = createMockEvent();

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('alarm');
  });

  it('returns empty array when event is null', () => {
    const markers = generateEventMarkers(null);
    expect(markers).toEqual([]);
  });

  it('returns empty array when event is undefined', () => {
    const markers = generateEventMarkers(undefined);
    expect(markers).toEqual([]);
  });

  it('returns empty array when total frames is invalid', () => {
    const mockEvent = createMockEvent({
      Frames: '0',
    });

    const markers = generateEventMarkers(mockEvent);
    expect(markers).toEqual([]);
  });

  it('returns empty array when event length is invalid', () => {
    const mockEvent = createMockEvent({
      Length: '0',
    });

    const markers = generateEventMarkers(mockEvent);
    expect(markers).toEqual([]);
  });

  it('skips alarm marker when alarm frame ID is missing', () => {
    const mockEvent = createMockEvent({
      AlarmFrameId: undefined,
      MaxScoreFrameId: '70',
    });

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('maxScore');
  });

  it('skips max score marker when max score frame ID is missing', () => {
    const mockEvent = createMockEvent({
      MaxScoreFrameId: undefined,
    });

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('alarm');
  });

  it('returns empty array when no frame IDs are provided', () => {
    const mockEvent = createMockEvent({
      AlarmFrameId: undefined,
      MaxScoreFrameId: undefined,
    });

    const markers = generateEventMarkers(mockEvent);
    expect(markers).toEqual([]);
  });

  it('handles string to number conversion for frame IDs', () => {
    const mockEvent = createMockEvent({
      AlarmFrameId: '25',
      MaxScoreFrameId: '75',
    });

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(2);
    expect(markers[0].frameId).toBe(25);
    expect(markers[1].frameId).toBe(75);
  });

  it('handles events with very short duration', () => {
    const mockEvent = createMockEvent({
      Length: '1.0',
      Frames: '30',
      AlarmFrameId: '15',
      MaxScoreFrameId: '20',
    });

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(2);
    expect(markers[0].time).toBe(0.5);
    expect(markers[1].time).toBeCloseTo(0.667, 2);
  });

  it('handles events with long duration', () => {
    const mockEvent = createMockEvent({
      Length: '3600.0',
      Frames: '108000',
      AlarmFrames: '100',
      AlarmFrameId: '54000',
      MaxScoreFrameId: '81000',
    });

    const markers = generateEventMarkers(mockEvent);

    expect(markers).toHaveLength(2);
    expect(markers[0].time).toBe(1800);
    expect(markers[1].time).toBe(2700);
  });
});
