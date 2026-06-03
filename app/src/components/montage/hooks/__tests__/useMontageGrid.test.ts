import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Layout } from 'react-grid-layout';
import { INTERNAL_COLS, migrateLayout, useMontageGrid } from '../useMontageGrid';
import { useSettingsStore } from '../../../../stores/settings';
import type { MonitorData } from '../../../../api/types';
import type { Profile } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Minimal but valid MonitorData fixture — just enough for calculateHeightUnits
const makeMonitor = (id: string): MonitorData => ({
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
    EncoderParameters: '',
    RecordAudio: '0',
    RTSPDescribe: '0',
    Brightness: -1,
    Contrast: -1,
    Hue: -1,
    Colour: -1,
    EventPrefix: 'Event-',
    LabelFormat: '%N - %d/%m/%y %H:%M:%S',
    LabelX: '0',
    LabelY: '0',
    LabelSize: '1',
    ImageBufferCount: '100',
    WarmupCount: '25',
    PreEventCount: '10',
    PostEventCount: '10',
    StreamReplayBuffer: '0',
    AlarmFrameCount: '1',
    SectionLength: '600',
    MinSectionLength: '10',
    FrameSkip: '0',
    MotionFrameSkip: '0',
    AnalysisFPSLimit: null,
    AnalysisUpdateDelay: '0',
    MaxFPS: null,
    AlarmMaxFPS: null,
    FPSReportInterval: '100',
    RefBlendPerc: '6',
    AlarmRefBlendPerc: '6',
    Controllable: '0',
    ControlId: null,
    ControlDevice: null,
    ControlAddress: null,
    AutoStopTimeout: null,
    TrackMotion: '0',
    TrackDelay: null,
    ReturnLocation: '-1',
    ReturnDelay: null,
    ModectDuringPTZ: '0',
    DefaultRate: '100',
    DefaultScale: '100',
    DefaultCodec: 'auto',
    SignalCheckPoints: '0',
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
    Go2RTCEnabled: false,
    RTSP2WebEnabled: false,
    JanusEnabled: false,
    Importance: 'Normal',
    Deleted: false,
  },
  Monitor_Status: {
    MonitorId: id,
    Status: 'Connected',
    CaptureFPS: '5.00',
    AnalysisFPS: '5.00',
    CaptureBandwidth: '1024000',
  },
});

const makeProfile = (id: string): Profile => ({
  id,
  name: 'Test Profile',
  portalUrl: 'http://localhost',
  apiUrl: 'http://localhost/api',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: true,
  createdAt: 0,
});

const buildNewFormatLayout = (displayCols: number, count: number): Layout[] => {
  const w = Math.max(1, Math.floor(INTERNAL_COLS / displayCols));
  const perRow = Math.floor(INTERNAL_COLS / w);
  return Array.from({ length: count }, (_, i) => ({
    i: `m${i}`,
    x: (i % perRow) * w,
    y: Math.floor(i / perRow) * 2,
    w,
    h: 2,
  }));
};

const buildLegacyLayout = (displayCols: number, count: number): Layout[] =>
  Array.from({ length: count }, (_, i) => ({
    i: `m${i}`,
    x: i % displayCols,
    y: Math.floor(i / displayCols) * 3,
    w: 1,
    h: 3,
  }));

describe('migrateLayout', () => {
  it('returns empty input unchanged', () => {
    expect(migrateLayout([], 5)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    'leaves new-format layouts (%i columns) untouched',
    (cols) => {
      const layout = buildNewFormatLayout(cols, 6);
      expect(migrateLayout(layout, cols)).toEqual(layout);
    }
  );

  it('migrates legacy w=1 layouts to the 12-col grid', () => {
    const legacy = buildLegacyLayout(5, 5);
    const migrated = migrateLayout(legacy, 5);

    const scale = Math.floor(INTERNAL_COLS / 5);
    expect(migrated).toEqual(
      legacy.map((item) => ({
        ...item,
        w: item.w * scale,
        x: item.x * scale,
      }))
    );
    expect(Math.max(...migrated.map((m) => m.w))).toBe(scale);
  });

  it('clamps oversized scaled values to internal grid bounds', () => {
    const legacy: Layout[] = [{ i: 'a', x: 11, y: 0, w: 1, h: 2 }];
    const migrated = migrateLayout(legacy, 1);
    expect(migrated[0].w).toBeLessThanOrEqual(INTERNAL_COLS);
    expect(migrated[0].x).toBeLessThanOrEqual(INTERNAL_COLS - 1);
  });

  it('does not corrupt a 5-column layout into a 3-column layout (regression for #135)', () => {
    const fiveCol = buildNewFormatLayout(5, 6);
    const result = migrateLayout(fiveCol, 5);
    expect(Math.max(...result.map((m) => m.w))).toBe(2);
  });

  it('does not corrupt a 6-column custom layout (regression for #135)', () => {
    const sixCol = buildNewFormatLayout(6, 6);
    const result = migrateLayout(sixCol, 6);
    expect(Math.max(...result.map((m) => m.w))).toBe(2);
  });
});

describe('group-switch re-init', () => {
  const profileId = 'test-profile';
  const monitors = [makeMonitor('10'), makeMonitor('20')];
  const profile = makeProfile(profileId);

  // Working layouts for each group — use new-format (w > 1) so migrateLayout is a no-op
  const workingLayoutA: Layout[] = [
    { i: '10', x: 0, y: 0, w: 6, h: 2 },
    { i: '20', x: 6, y: 0, w: 6, h: 2 },
  ];
  const workingLayoutB: Layout[] = [
    { i: '20', x: 0, y: 0, w: 3, h: 2 },
    { i: '10', x: 3, y: 0, w: 3, h: 2 },
  ];

  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
    const { updateMontageGroupLayout } = useSettingsStore.getState();
    updateMontageGroupLayout(profileId, 'A', {
      gridCols: 2,
      workingLayout: workingLayoutA,
    });
    updateMontageGroupLayout(profileId, 'B', {
      gridCols: 4,
      workingLayout: workingLayoutB,
    });
  });

  it('re-syncs gridCols and rebuilds layout when groupKey switches', () => {
    const settingsA = useSettingsStore.getState().getProfileSettings(profileId);

    type HookProps = Parameters<typeof useMontageGrid>[0];
    const initialProps: HookProps = {
      monitors,
      currentProfile: profile,
      settings: settingsA,
      isEditMode: false,
      groupKey: 'A',
    };

    const { result, rerender } = renderHook(
      (props: HookProps) => useMontageGrid(props),
      { initialProps }
    );

    // Trigger layout build — first call sets hasWidth=true, which fires the restore effect
    act(() => { result.current.handleWidthChange(800); });

    // After the width is set, a second call recalculates heights (not required for this test)
    // gridCols should reflect group A's bucket
    expect(result.current.gridCols).toBe(2);

    // Layout should be non-empty and contain only monitor ids from the fixture
    const monitorIds = new Set(monitors.map((m) => m.Monitor.Id));
    expect(result.current.layout.length).toBeGreaterThan(0);
    for (const item of result.current.layout) {
      expect(monitorIds.has(item.i)).toBe(true);
    }

    // Switch to group B
    const settingsB = useSettingsStore.getState().getProfileSettings(profileId);
    rerender({ ...initialProps, groupKey: 'B', settings: settingsB });

    // Re-trigger width so the restore effect (which depends on [displayCols, hasWidth, groupKey])
    // can run again with the new groupKey in scope.
    act(() => { result.current.handleWidthChange(800); });

    // gridCols must now reflect group B's bucket
    expect(result.current.gridCols).toBe(4);

    // Layout must still be non-empty and all items correspond to fixture monitors
    expect(result.current.layout.length).toBeGreaterThan(0);
    for (const item of result.current.layout) {
      expect(monitorIds.has(item.i)).toBe(true);
    }
  });
});
