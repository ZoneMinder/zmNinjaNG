/**
 * Unit tests for monitor filtering utilities
 */

import { describe, it, expect } from 'vitest';
import {
  filterEnabledMonitors,
  getEnabledMonitorIds,
  isMonitorEnabled,
} from '../filters';
import type { MonitorData } from '../../api/types';

// Helper to create mock monitor data
const createMockMonitor = (id: string, deleted = false): MonitorData => ({
  Monitor: {
    Id: id,
    Name: `Monitor ${id}`,
    ServerId: '1',
    StorageId: '1',
    Type: 'Local',
    Function: 'Modect',
    Enabled: '1',
    LinkedMonitors: null,
    Triggers: '',
    Device: '',
    Channel: '0',
    Format: '0',
    V4LMultiBuffer: null,
    V4LCapturesPerFrame: '1',
    Protocol: null,
    Method: null,
    Host: null,
    Port: '80',
    SubPath: '',
    Path: null,
    SecondPath: null,
    Options: null,
    User: null,
    Pass: null,
    Width: '1920',
    Height: '1080',
    Colours: '4',
    Palette: '0',
    Orientation: 'ROTATE_0',
    Deinterlacing: '0',
    DecoderHWAccelName: null,
    DecoderHWAccelDevice: null,
    SaveJPEGs: '3',
    VideoWriter: '0',
    OutputCodec: null,
    Encoder: 'auto',
    OutputContainer: null,
    EncoderParameters: '',
    RecordAudio: '0',
    RTSPDescribe: '0',
    Brightness: -1,
    Contrast: -1,
    Hue: -1,
    Colour: -1,
    EventPrefix: 'Event-',
    LabelFormat: '%N - %d/%m/%y %H:%M:%S',
    LabelX: 0,
    LabelY: 0,
    LabelSize: 1,
    ImageBufferCount: 100,
    MaxImageBufferCount: 0,
    WarmupCount: 25,
    PreEventCount: 10,
    PostEventCount: 10,
    StreamReplayBuffer: 0,
    AlarmFrameCount: 1,
    SectionLength: 600,
    MinSectionLength: 10,
    FrameSkip: 0,
    MotionFrameSkip: 0,
    AnalysisFPSLimit: null,
    AnalysisUpdateDelay: 0,
    MaxFPS: null,
    AlarmMaxFPS: null,
    FPSReportInterval: 100,
    RefBlendPerc: 6,
    AlarmRefBlendPerc: 6,
    Controllable: '0',
    ControlId: null,
    ControlDevice: null,
    ControlAddress: null,
    AutoStopTimeout: null,
    TrackMotion: '0',
    TrackDelay: null,
    ReturnLocation: -1,
    ReturnDelay: null,
    ModectDuringPTZ: '0',
    DefaultRate: 100,
    DefaultScale: 100,
    DefaultCodec: 'auto',
    SignalCheckPoints: 0,
    SignalCheckColour: '#0000BE',
    WebColour: 'red',
    Exif: '0',
    Sequence: null,
    ZoneCount: 0,
    Refresh: null,
    Latitude: null,
    Longitude: null,
    RTSPServer: '0',
    RTSPStreamName: '',
    Importance: 'Normal',
    Deleted: deleted,
  },
  Monitor_Status: {
    MonitorId: id,
    Status: 'Connected',
    CaptureFPS: '5.00',
    AnalysisFPS: '5.00',
    CaptureBandwidth: '1024000',
  },
});

describe('filterEnabledMonitors', () => {
  it('returns all monitors when none are deleted', () => {
    const monitors = [
      createMockMonitor('1'),
      createMockMonitor('2'),
      createMockMonitor('3'),
    ];

    const result = filterEnabledMonitors(monitors);

    expect(result).toHaveLength(3);
    expect(result).toEqual(monitors);
  });

  it('filters out deleted monitors', () => {
    const monitors = [
      createMockMonitor('1', false),
      createMockMonitor('2', true),  // deleted
      createMockMonitor('3', false),
      createMockMonitor('4', true),  // deleted
    ];

    const result = filterEnabledMonitors(monitors);

    expect(result).toHaveLength(2);
    expect(result[0].Monitor.Id).toBe('1');
    expect(result[1].Monitor.Id).toBe('3');
  });

  it('returns empty array when all monitors are deleted', () => {
    const monitors = [
      createMockMonitor('1', true),
      createMockMonitor('2', true),
    ];

    const result = filterEnabledMonitors(monitors);

    expect(result).toHaveLength(0);
  });

  it('handles empty array', () => {
    const result = filterEnabledMonitors([]);

    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it('preserves monitor order', () => {
    const monitors = [
      createMockMonitor('5', false),
      createMockMonitor('2', true),
      createMockMonitor('9', false),
      createMockMonitor('1', false),
    ];

    const result = filterEnabledMonitors(monitors);

    expect(result).toHaveLength(3);
    expect(result[0].Monitor.Id).toBe('5');
    expect(result[1].Monitor.Id).toBe('9');
    expect(result[2].Monitor.Id).toBe('1');
  });
});

describe('getEnabledMonitorIds', () => {
  it('returns IDs of enabled monitors', () => {
    const monitors = [
      createMockMonitor('1'),
      createMockMonitor('2'),
      createMockMonitor('3'),
    ];

    const result = getEnabledMonitorIds(monitors);

    expect(result).toEqual(['1', '2', '3']);
  });

  it('excludes IDs of deleted monitors', () => {
    const monitors = [
      createMockMonitor('1', false),
      createMockMonitor('2', true),  // deleted
      createMockMonitor('3', false),
      createMockMonitor('4', true),  // deleted
    ];

    const result = getEnabledMonitorIds(monitors);

    expect(result).toEqual(['1', '3']);
  });

  it('returns empty array when all monitors are deleted', () => {
    const monitors = [
      createMockMonitor('1', true),
      createMockMonitor('2', true),
    ];

    const result = getEnabledMonitorIds(monitors);

    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const result = getEnabledMonitorIds([]);

    expect(result).toEqual([]);
  });

  it('preserves ID order', () => {
    const monitors = [
      createMockMonitor('10', false),
      createMockMonitor('5', true),
      createMockMonitor('3', false),
      createMockMonitor('15', false),
    ];

    const result = getEnabledMonitorIds(monitors);

    expect(result).toEqual(['10', '3', '15']);
  });

  it('handles string IDs correctly', () => {
    const monitors = [
      createMockMonitor('abc'),
      createMockMonitor('def'),
    ];

    const result = getEnabledMonitorIds(monitors);

    expect(result).toEqual(['abc', 'def']);
  });
});

describe('isMonitorEnabled', () => {
  const monitors = [
    createMockMonitor('1', false),
    createMockMonitor('2', true),   // deleted
    createMockMonitor('3', false),
  ];

  it('returns true for enabled monitor', () => {
    expect(isMonitorEnabled('1', monitors)).toBe(true);
    expect(isMonitorEnabled('3', monitors)).toBe(true);
  });

  it('returns false for deleted monitor', () => {
    expect(isMonitorEnabled('2', monitors)).toBe(false);
  });

  it('returns false for non-existent monitor', () => {
    expect(isMonitorEnabled('999', monitors)).toBe(false);
  });

  it('returns false for empty string ID', () => {
    expect(isMonitorEnabled('', monitors)).toBe(false);
  });

  it('handles empty monitor list', () => {
    expect(isMonitorEnabled('1', [])).toBe(false);
  });

  it('is case-sensitive for IDs', () => {
    expect(isMonitorEnabled('1', monitors)).toBe(true);
    expect(isMonitorEnabled('1', monitors)).toBe(true);
  });

  it('handles monitors with deleted = false explicitly', () => {
    const explicitMonitors = [
      createMockMonitor('1', false),
    ];

    expect(isMonitorEnabled('1', explicitMonitors)).toBe(true);
  });
});
