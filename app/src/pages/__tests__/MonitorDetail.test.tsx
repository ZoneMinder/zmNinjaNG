/**
 * MonitorDetail Page Tests
 *
 * All-mode deep route (refs #337): `/all/monitors/:profileId/:monitorId` carries
 * the owning profile as a route param. MonitorDetail must fetch via THAT
 * profile's client/keys regardless of which profile (if any) is globally
 * current, and must render the existing error state - never crash - for an
 * unknown profileId.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MonitorDetail from '../MonitorDetail';

const h = vi.hoisted(() => ({
  routeParams: { id: '1' } as Record<string, string | undefined>,
  locationState: {} as Record<string, unknown>,
  settings: {
    monitorDetailFeedFit: 'contain',
    monitorDetailCycleSeconds: 0,
    showProtocolLabel: false,
    insomnia: false,
    forceDisableMultiPort: false,
  } as Record<string, unknown>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => h.routeParams,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: h.locationState, key: 'k1' }),
}));

vi.mock('../../hooks/useMainScrollRestoration', () => ({
  useMainScrollRestoration: () => {},
}));

const getSessionMock = vi.fn((id: string) => ({ client: `client-${id}`, profileId: id }));
const tryGetCurrentSessionMock = vi.fn(() => ({ client: 'client-current', profileId: 'profile-1' }));
vi.mock('../../services/sessions', () => ({
  getSession: (id: string) => getSessionMock(id),
  tryGetCurrentSession: () => tryGetCurrentSessionMock(),
  // stores/profile.ts (pulled in transitively, real in this test) registers
  // its gate at module load - the mock needs the export even though this
  // suite never exercises it.
  registerSessionsGate: vi.fn(),
}));

const useQueryMock = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[]; queryFn: () => unknown; enabled?: boolean }) =>
    useQueryMock(options),
}));

vi.mock('../../api/monitors', () => ({
  getMonitor: vi.fn(),
  getControl: vi.fn(),
  updateMonitor: vi.fn(),
}));
vi.mock('../../api/zones', () => ({ getZones: vi.fn() }));

vi.mock('../../hooks/useCurrentProfile', () => ({
  // The scroll pad reads the remembered setting through this one; the page
  // itself only ever calls useProfileById.
  useCurrentProfile: () => ({ settings: h.settings }),
  useProfileById: (profileId?: string) => ({
    profile: profileId === 'unknown-profile'
      ? null
      : { id: profileId ?? 'profile-1', portalUrl: 'https://portal.test', apiUrl: 'https://api.test' },
    settings: h.settings,
  }),
}));

const updateProfileSettings = vi.fn();
vi.mock('../../stores/settings', () => ({
  useSettingsStore: (sel: (s: { updateProfileSettings: typeof updateProfileSettings }) => unknown) =>
    sel({ updateProfileSettings }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/download', () => ({ downloadSnapshotFromElement: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useInsomnia', () => ({ useInsomnia: () => {} }));
vi.mock('../../hooks/useZoomPan', () => ({
  useZoomPan: () => ({ ref: { current: null }, innerRef: { current: null }, reset: vi.fn() }),
}));
vi.mock('../../hooks/useServerUrls', () => ({
  useServerUrls: () => ({ portalPath: 'https://portal.test/index.php', apiBaseUrl: 'https://api.test' }),
}));

vi.mock('../../lib/logger', () => ({
  log: new Proxy({}, { get: () => vi.fn() }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../../components/monitors/PTZControls', () => ({ PTZControls: () => <div data-testid="ptz-controls" /> }));
const liveMonitorPlayerMock = vi.fn();
vi.mock('../../components/monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: (props: Record<string, unknown>) => {
    liveMonitorPlayerMock(props);
    return <div data-testid="live-player" />;
  },
}));
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({ AnalysisFramesToggle: () => <div /> }));
vi.mock('../../components/monitors/ZoneOverlay', () => ({ ZoneOverlay: () => <div /> }));
vi.mock('../../components/monitors/ZoneLegend', () => ({ ZoneLegend: () => <div /> }));
vi.mock('../../components/monitors/MonitorRecentEvents', () => ({
  MonitorRecentEvents: () => <div data-testid="monitor-recent-events" />,
}));
vi.mock('../../components/monitor-detail/MonitorSettingsDialog', () => ({
  MonitorSettingsDialog: () => <div data-testid="monitor-settings-dialog" />,
}));
vi.mock('../../components/monitor-detail/MonitorControlsCard', () => ({
  MonitorControlsCard: () => <div data-testid="monitor-controls-card" />,
}));
vi.mock('../../components/ui/zoom-controls', () => ({ ZoomControls: () => <div data-testid="zoom-controls" /> }));

vi.mock('../hooks', () => ({
  usePTZControl: () => ({ handlePTZCommand: vi.fn() }),
  useAlarmControl: () => ({
    hasAlarmStatus: false,
    displayAlarmArmed: false,
    alarmStatusLabel: '',
    isAlarmLoading: false,
    isAlarmUpdating: false,
    alarmBorderClass: '',
    handleAlarmToggle: vi.fn(),
  }),
  useModeControl: () => ({ isModeUpdating: false, handleModeChange: vi.fn() }),
  useMonitorNavigation: () => ({
    isSliding: false,
    enabledMonitors: [],
    hasPrev: false,
    hasNext: false,
    onSwipeLeft: vi.fn(),
    onSwipeRight: vi.fn(),
  }),
}));

const monitor = {
  Monitor: {
    Id: '1',
    Name: 'Front Door',
    Width: '640',
    Height: '480',
    Controllable: '0',
    Function: 'Monitor',
  },
  Monitor_Status: {},
};

describe('MonitorDetail All-mode deep route (refs #337)', () => {
  beforeEach(() => {
    h.locationState = {};
    getSessionMock.mockClear();
    tryGetCurrentSessionMock.mockClear();
    useQueryMock.mockReset();
    liveMonitorPlayerMock.mockClear();
  });

  afterEach(() => {
    h.routeParams = { id: '1' };
  });

  it('fetches the monitor via the route profileId\'s client and query key', () => {
    h.routeParams = { profileId: 'profile-b', monitorId: '1' };
    const seenKeys: unknown[][] = [];
    useQueryMock.mockImplementation(({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: () => unknown }) => {
      seenKeys.push([...queryKey]);
      if (queryKey[0] === 'monitor') {
        // Invoke the queryFn so we can assert it resolves the client via the
        // route's profileId (getSession), never the current session
        // (tryGetCurrentSession never called).
        queryFn();
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(seenKeys).toContainEqual(['monitor', 'profile-b', '1']);
    expect(getSessionMock).toHaveBeenCalledWith('profile-b');
    expect(tryGetCurrentSessionMock).not.toHaveBeenCalled();
  });

  it('passes the route profileId to LiveMonitorPlayer on the All-mode deep route (refs #337 C1)', () => {
    h.routeParams = { profileId: 'profile-b', monitorId: '1' };
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'monitor') {
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(liveMonitorPlayerMock).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-b' })
    );
  });

  it('falls back to the current session and single-mode key when the route has no profileId', () => {
    h.routeParams = { id: '1' };
    useQueryMock.mockImplementation(({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: () => unknown }) => {
      if (queryKey[0] === 'monitor') {
        queryFn();
        return { data: monitor, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    });

    render(<MonitorDetail />);

    expect(tryGetCurrentSessionMock).toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('renders the existing error state instead of crashing for an unknown route profileId', () => {
    h.routeParams = { profileId: 'unknown-profile', monitorId: '1' };
    useQueryMock.mockImplementation(() => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }));

    render(<MonitorDetail />);

    expect(screen.getByText('monitor_detail.load_error')).toBeTruthy();
    expect(getSessionMock).not.toHaveBeenCalledWith('unknown-profile');
  });
});
