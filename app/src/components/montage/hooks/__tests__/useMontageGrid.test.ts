import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Layout } from 'react-grid-layout';
import { COL_SUBDIVISION, isLegacyLayout, useMontageGrid } from '../useMontageGrid';
import { useSettingsStore } from '../../../../stores/settings';
import type { MonitorData } from '../../../../api/types';
import type { Profile } from '../../../../api/types';
import { asProfileId } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Minimal but valid MonitorData fixture: just enough for calculateHeightUnits
const makeMonitor = (id: string, orientation = 'ROTATE_0'): MonitorData => ({
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
    Orientation: orientation,
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
  id: asProfileId(id),
  name: 'Test Profile',
  portalUrl: 'http://localhost',
  apiUrl: 'http://localhost/api',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: true,
  createdAt: 0,
});

// Proportional (current) format: each default tile is one column wide
// (COL_SUBDIVISION units) and perRow == displayCols exactly.
const buildNewFormatLayout = (displayCols: number, count: number): Layout[] => {
  const w = COL_SUBDIVISION;
  return Array.from({ length: count }, (_, i) => ({
    i: `m${i}`,
    x: (i % displayCols) * w,
    y: Math.floor(i / displayCols) * 2,
    w,
    h: 2,
  }));
};

// Legacy fixed 12-column format: w = floor(12/cols), rightmost edge within 12.
const buildLegacyLayout = (displayCols: number, count: number): Layout[] => {
  const w = Math.max(1, Math.floor(12 / displayCols));
  const perRow = Math.floor(12 / w);
  return Array.from({ length: count }, (_, i) => ({
    i: `m${i}`,
    x: (i % perRow) * w,
    y: Math.floor(i / perRow) * 3,
    w,
    h: 3,
  }));
};

describe('isLegacyLayout', () => {
  it('treats an empty layout as non-legacy', () => {
    expect(isLegacyLayout([], 5)).toBe(false);
  });

  it('never flags single-column layouts (spaces coincide)', () => {
    expect(isLegacyLayout(buildLegacyLayout(1, 4), 1)).toBe(false);
  });

  it.each([2, 3, 4, 5, 6, 9])(
    'flags a legacy fixed-12 layout for %i columns',
    (cols) => {
      expect(isLegacyLayout(buildLegacyLayout(cols, 6), cols)).toBe(true);
    }
  );

  it('flags the older w=1 format', () => {
    const w1: Layout[] = Array.from({ length: 5 }, (_, i) => ({
      i: `m${i}`, x: i % 5, y: 0, w: 1, h: 3,
    }));
    expect(isLegacyLayout(w1, 5)).toBe(true);
  });

  it.each([2, 3, 4, 5, 6, 9])(
    'does not flag a current proportional layout for %i columns',
    (cols) => {
      expect(isLegacyLayout(buildNewFormatLayout(cols, 6), cols)).toBe(false);
    }
  );
});

describe('proportional columns (#220)', () => {
  const profileId = 'cols-profile';
  const profile = makeProfile(profileId);
  // 12 monitors: enough to fill more than one row for every tested column count.
  const monitors = Array.from({ length: 12 }, (_, i) => makeMonitor(`${i + 1}`));

  const renderWithCols = (cols: number) => {
    useSettingsStore.setState({ profileSettings: {} });
    useSettingsStore.getState().updateMontageGroupLayout(profileId, 'A', {
      gridCols: cols,
      workingLayout: [],
    });
    const settings = useSettingsStore.getState().getProfileSettings(profileId);

    type HookProps = Parameters<typeof useMontageGrid>[0];
    const { result } = renderHook(
      (props: HookProps) => useMontageGrid(props),
      { initialProps: { monitors, currentProfile: profile, settings, isEditMode: false, groupKey: 'A' } }
    );
    act(() => { result.current.handleWidthChange(1200); });
    return result;
  };

  // The bug: 5 rendered 6 columns, 9 rendered 12. Assert the top row of the
  // default layout has exactly `cols` tiles for divisors and non-divisors alike.
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'renders exactly %i columns in the first row',
    (cols) => {
      const result = renderWithCols(cols);
      const items = result.current.layout;
      expect(items.length).toBe(monitors.length);

      const minY = Math.min(...items.map((i) => i.y));
      const firstRow = items.filter((i) => i.y === minY);
      expect(firstRow.length).toBe(Math.min(cols, monitors.length));

      // Distinct x positions in the first row also equal the column count.
      const xs = new Set(firstRow.map((i) => i.x));
      expect(xs.size).toBe(Math.min(cols, monitors.length));
    }
  );

  it('rebuilds a legacy fixed-12 layout to the selected column count', () => {
    useSettingsStore.setState({ profileSettings: {} });
    // Stored as the old 5-column layout, which actually encoded 6 columns.
    useSettingsStore.getState().updateMontageGroupLayout(profileId, 'A', {
      gridCols: 5,
      workingLayout: buildLegacyLayout(5, 12).map((item, i) => ({ ...item, i: `${i + 1}` })),
    });
    const settings = useSettingsStore.getState().getProfileSettings(profileId);

    type HookProps = Parameters<typeof useMontageGrid>[0];
    const { result } = renderHook(
      (props: HookProps) => useMontageGrid(props),
      { initialProps: { monitors, currentProfile: profile, settings, isEditMode: false, groupKey: 'A' } }
    );
    act(() => { result.current.handleWidthChange(1200); });

    const items = result.current.layout;
    const minY = Math.min(...items.map((i) => i.y));
    const firstRow = items.filter((i) => i.y === minY);
    expect(firstRow.length).toBe(5);
    expect(firstRow.every((i) => i.w === COL_SUBDIVISION)).toBe(true);

    // The rebuilt layout is persisted so it isn't re-migrated on next load.
    const persisted = useSettingsStore.getState()
      .getProfileSettings(profileId).montageByGroup?.['A']?.workingLayout;
    expect(persisted && isLegacyLayout(persisted, 5)).toBe(false);
  });
});

// Ported from the deleted src/pages/__tests__/Montage.test.tsx, which had its
// own copy of calculateHeightUnits. The copy drifted from the shipped one
// (Math.round for Math.ceil, no card-header term), so its numbers passed while
// describing a layout the app never rendered. These run through the hook.
describe('tile heights for rotated monitors', () => {
  const profileId = 'rotation-profile';
  const profile = makeProfile(profileId);

  // gridWidth 1200 over 2 display columns: each tile is 600px of video width.
  // The shipped formula adds MONTAGE_GRID.cardHeaderHeightPx (32) and rounds up
  // against GRID_LAYOUT.montageRowHeight (1), with margin 0.
  //   ROTATE_0:  600 * (1080/1920) = 337.5 + 32 -> ceil 370
  //   ROTATE_90: 600 * (1920/1080) = 1066.6 + 32 -> ceil 1099
  const heightsFor = (orientation: string, gridWidth = 1200) => {
    useSettingsStore.setState({ profileSettings: {} });
    useSettingsStore.getState().updateMontageGroupLayout(profileId, 'A', {
      gridCols: 2,
      workingLayout: [],
    });
    const settings = useSettingsStore.getState().getProfileSettings(profileId);
    const monitors = [makeMonitor('1', orientation)];

    type HookProps = Parameters<typeof useMontageGrid>[0];
    const { result } = renderHook(
      (props: HookProps) => useMontageGrid(props),
      { initialProps: { monitors, currentProfile: profile, settings, isEditMode: false, groupKey: 'A' } }
    );
    act(() => { result.current.handleWidthChange(gridWidth); });
    return result.current.layout[0].h;
  };

  it('sizes an unrotated 1920x1080 tile to the video height plus the card header', () => {
    expect(heightsFor('ROTATE_0')).toBe(370);
  });

  it.each(['ROTATE_90', 'ROTATE_270'])('swaps the dimensions for %s', (orientation) => {
    expect(heightsFor(orientation)).toBe(1099);
  });

  it('keeps a rotated tile taller than the same monitor unrotated', () => {
    expect(heightsFor('ROTATE_90')).toBeGreaterThan(heightsFor('ROTATE_0') * 2);
  });

  it('scales the height with the grid width', () => {
    const wide = heightsFor('ROTATE_90', 1200);
    const narrow = heightsFor('ROTATE_90', 1000);
    // Video height is proportional to width; the fixed header term is the only
    // part that does not scale, so the ratio lands just under 1200/1000.
    expect(wide / narrow).toBeGreaterThan(1.15);
    expect(wide / narrow).toBeLessThan(1.2);
  });
});

describe('group-switch re-init', () => {
  const profileId = 'test-profile';
  const monitors = [makeMonitor('10'), makeMonitor('20')];
  const profile = makeProfile(profileId);

  // Working layouts for each group. Legacy-format positions are rebuilt to the
  // group's column count on restore; the assertions below only check gridCols
  // and that every tile maps to a fixture monitor, which holds either way.
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

    // Trigger layout build: first call sets hasWidth=true, which fires the restore effect
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

// All mode (currentProfile null) has nothing to persist a layout change
// against, so editing must be fully inert - not just un-persisted, but
// visually unchanged too (refs #337, Phase 4 Task 1 fix round 1). A resize
// that updated local state anyway would visibly move the tile until some
// unrelated re-render snapped it back to the stored layout.
describe('All mode: editing is inert (no real profile to persist against)', () => {
  const monitors = [makeMonitor('10'), makeMonitor('20')];

  it('leaves the layout unchanged when handleResizeStop fires with no current profile', () => {
    type HookProps = Parameters<typeof useMontageGrid>[0];
    const { result } = renderHook(
      (props: HookProps) => useMontageGrid(props),
      {
        initialProps: {
          monitors,
          currentProfile: null,
          settings: useSettingsStore.getState().getProfileSettings(''),
          isEditMode: true,
          groupKey: 'A',
        },
      }
    );

    act(() => { result.current.handleWidthChange(800); });
    const before = result.current.layout;
    expect(before.length).toBe(2);

    act(() => {
      result.current.handleResizeStop(
        before,
        before[0],
        { ...before[0], w: before[0].w + 4, h: before[0].h + 4 }
      );
    });

    expect(result.current.layout).toBe(before);
  });
});
