/**
 * MontageMonitor Tests
 *
 * Basic tests for the MontageMonitor component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MontageMonitor } from '../MontageMonitor';
import type { Monitor, MonitorStatus, Profile } from '../../../api/types';
import { asProfileId } from '../../../api/types';
import { useMonitorStore } from '../../../stores/monitors';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../../stores/settings';
import { useMonitorSeenStore } from '../../../stores/monitorSeen';
import { useNotificationStore } from '../../../stores/notifications';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}_${JSON.stringify(params)}` : key,
  }),
}));

const mockRouterNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockRouterNavigate,
}));

// useOpenMonitorEvents (used by the Events button) reads the profile through
// this hook independently of the `currentProfile` prop MontageMonitor takes.
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-1', portalUrl: 'https://test', cgiUrl: 'https://test/cgi', apiUrl: 'https://test/api' },
    settings: {},
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../../lib/http', () => ({
  httpGet: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../services/download', () => ({
  downloadSnapshotFromElement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    montageMonitor: vi.fn(),
    videoPlayer: vi.fn(),
    monitor: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

vi.mock('../../../lib/monitor/monitor-rotation', () => ({
  getMonitorAspectRatio: (width: number, height: number) =>
    `${width}/${height}`,
}));

vi.mock('../LiveMonitorPlayer', () => ({
  // The reduce flag is reflected back so a test can assert the tile forwards
  // what the page decided about stream tuning.
  LiveMonitorPlayer: ({
    reduceStream,
    paused,
    forceViewMode,
  }: {
    reduceStream?: boolean;
    paused?: boolean;
    forceViewMode?: string;
  }) => (
    <div
      data-testid="video-player"
      data-reduce-stream={String(reduceStream ?? false)}
      data-paused={String(paused ?? false)}
      data-force-view-mode={forceViewMode ?? 'none'}
    >
      Mock LiveMonitorPlayer
    </div>
  ),
}));

vi.mock('../../../hooks/useServerUrls', () => ({
  useServerUrls: () => ({
    recordingUrl: '',
    portalPath: '',
    apiBaseUrl: '',
    isMultiServer: false,
  }),
}));

// Partial: the hover preview this component can now wrap its player in pulls
// in the stream lifecycle, which registers its resolver against this module on
// import. A hand-listed mock drops that export and the whole file fails to
// load rather than any one test failing.
// The hover preview this component can now wrap its player in pulls in the
// stream lifecycle, which registers a resolver against this module and
// subscribes to the store. Keep the hand-written selector shape the tests
// rely on, and add what the new import path needs.
vi.mock('../../../stores/auth', () => {
  const useAuthStore = Object.assign(
    (selector: (state: { version: string }) => unknown) => selector({ version: '1.38.0' }),
    { subscribe: () => () => {}, getState: () => ({ version: '1.38.0' }) },
  );
  return {
    useAuthStore,
    useAuthSlice: () => ({ version: '1.38.0' }),
    registerAuthClientResolver: () => {},
  };
});

vi.mock('../../../stores/notifications', () => {
  const state = { profileEvents: {} };
  const store = (selector: (s: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  store.subscribe = () => () => {};
  return { useNotificationStore: store };
});

describe('MontageMonitor', () => {
  const mockMonitor: Monitor = {
    Id: '1',
    Name: 'Front Door',
    Width: '1920',
    Height: '1080',
    Orientation: '0',
    Function: 'Modect',
    Capturing: 'Always',
    Analysing: 'Always',
    Enabled: '1',
  } as Monitor;

  const mockStatus: MonitorStatus = {
    MonitorId: '1',
    Status: 'Connected',
    CaptureFPS: '15.00',
    AnalysisFPS: '10.00',
  };

  const mockProfile: Profile = {
    id: asProfileId('profile-1'),
    name: 'Test Profile',
    apiUrl: 'https://test.com',
    portalUrl: 'https://test.com',
    cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false,
    createdAt: Date.now(),
  };

  const mockNavigate = vi.fn();

  beforeEach(() => {
    // Reset stores
    useMonitorStore.setState({
      connKeys: {},
      regenerateConnKey: vi.fn((monitorId: string) => {
        const key = Date.now() + parseInt(monitorId);
        useMonitorStore.setState((state) => ({
          connKeys: { ...state.connKeys, [monitorId]: key },
        }));
        return key;
      }),
    });

    useSettingsStore.setState({
      profileSettings: {
        'profile-1': {
          ...DEFAULT_SETTINGS,
          viewMode: 'streaming',
          streamScale: 50,
          streamMaxFps: 5,
        },
      },
    });

    useMonitorSeenStore.setState({ profileWatermarks: {} });
    mockRouterNavigate.mockClear();

    vi.clearAllMocks();
  });

  it('renders monitor name and status', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
  });

  it('streams at full quality unless the page asks for reduced tuning', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    expect(screen.getByTestId('video-player')).toHaveAttribute('data-reduce-stream', 'false');
  });

  it('passes the reduced-tuning decision down to the player', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        reduceStream
      />
    );

    expect(screen.getByTestId('video-player')).toHaveAttribute('data-reduce-stream', 'true');
  });

  it('downgrades the player to snapshots when the page says the user is idle', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        forceViewMode="snapshot"
      />
    );

    expect(screen.getByTestId('video-player')).toHaveAttribute(
      'data-force-view-mode',
      'snapshot'
    );
  });

  it('stops the player when the page pauses its tiles', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        paused
      />
    );

    expect(screen.getByTestId('video-player')).toHaveAttribute('data-paused', 'true');
  });

  it('sizes the video area from the ratio it is given, header on top', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        mediaAspectRatio="4 / 3"
      />
    );

    const media = screen.getByTestId('montage-monitor-media');
    // On the media area, not the card: on the card the h-8 header would eat
    // into the camera's shape and the picture would crop (refs #313).
    expect(media.style.aspectRatio).toBe('4 / 3');
    // flex-1 sets a zero flex basis, which collapses a ratio box whose
    // container has no height of its own.
    expect(media.className).not.toContain('flex-1');
  });

  it('leaves the video area filling the tile when no ratio is given', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    // Montage sizes its tiles through react-grid-layout and must keep doing so.
    const media = screen.getByTestId('montage-monitor-media');
    expect(media.style.aspectRatio).toBe('');
    expect(media.className).toContain('flex-1');
  });

  it('displays running status badge for connected monitor', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      const badge = document.querySelector('.bg-green-500');
      expect(badge).toBeInTheDocument();
    });
  });

  it('displays error status badge for disconnected monitor', async () => {
    const disconnectedStatus: MonitorStatus = {
      MonitorId: '1',
      Status: 'Disconnected',
    };

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={disconnectedStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      const badge = document.querySelector('.bg-red-500');
      expect(badge).toBeInTheDocument();
    });
  });

  // New-events badge (refs #239): the montage tile shows the same
  // "events since you last looked" badge as MonitorCard, not the red
  // session-notification bubble.
  it('shows the new-events badge with the count when newEventCount is positive', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        newEventCount={2}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('montage-new-events-badge')).toHaveTextContent('2');
    });
  });

  it('does not show the new-events badge when newEventCount is zero', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        newEventCount={0}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('montage-new-events-badge')).not.toBeInTheDocument();
  });

  it('does not show the new-events badge when newEventCount is undefined', async () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('montage-new-events-badge')).not.toBeInTheDocument();
  });

  it('opens the filtered events for this monitor when the Events button is clicked', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('profile-1', '1', '2026-07-10 08:49:37');

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        newEventCount={2}
        newestEventAt="2026-07-10 09:15:00"
      />
    );

    await user.click(screen.getByTestId('montage-events-btn'));

    expect(mockRouterNavigate).toHaveBeenCalledTimes(1);
    const [url, options] = mockRouterNavigate.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('monitorId')).toBe('1');
    expect(params.get('startDateTime')).toBe('2026-07-10T08:49:38');
    expect(options).toEqual({ state: { from: '/montage' } });
  });

  // refs #313: a tile rendered by Live Activity has to send the user back to
  // Live Activity, not to Montage, so the route it was rendered from is a prop
  // rather than a hardcoded string.
  it('sends the caller-supplied route as the events back link', async () => {
    const user = userEvent.setup();

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        fromRoute="/live-activity"
      />
    );

    await user.click(screen.getByTestId('montage-events-btn'));

    const [, options] = mockRouterNavigate.mock.calls[0];
    expect(options).toEqual({ state: { from: '/live-activity' } });
  });

  it('passes the route it was rendered from to the timeline as navigation state', async () => {
    const user = userEvent.setup();

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        fromRoute="/live-activity"
      />
    );

    await user.click(screen.getByTestId('montage-more-btn'));
    await user.click(await screen.findByTestId('montage-timeline-btn'));

    expect(mockNavigate).toHaveBeenCalledWith('/timeline?monitorId=1', {
      state: { from: '/live-activity' },
    });
  });

  it('defaults the timeline back link to the montage route when no route is given', async () => {
    const user = userEvent.setup();

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    await user.click(screen.getByTestId('montage-more-btn'));
    await user.click(await screen.findByTestId('montage-timeline-btn'));

    expect(mockNavigate).toHaveBeenCalledWith('/timeline?monitorId=1', {
      state: { from: '/montage' },
    });
  });

  // All mode (refs #337, Phase 4 Task 1): the tile shows which server a
  // monitor belongs to once more than one profile's tiles share one grid.
  it('shows a profile chip when profileChip is given', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        profileChip="Office"
      />
    );

    expect(screen.getByTestId('montage-profile-chip')).toHaveTextContent('Office');
  });

  it('renders no profile chip in single mode (profileChip absent)', () => {
    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    expect(screen.queryByTestId('montage-profile-chip')).not.toBeInTheDocument();
  });

  // The Events button must scope the watermark to the tile's OWNING profile,
  // not whatever useCurrentProfile() (the globally-selected profile) returns -
  // in All mode those differ (refs #337, Phase 4 Task 1).
  it('scopes the events watermark to the profileId prop, not the current profile', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('profile-2', '1', '2026-07-10 08:49:37');

    render(
      <MontageMonitor
        monitor={mockMonitor}
        status={mockStatus}
        currentProfile={mockProfile}
        accessToken="test-token"
        navigate={mockNavigate}
        profileId={asProfileId('profile-2')}
        newEventCount={2}
        newestEventAt="2026-07-10 09:15:00"
      />
    );

    await user.click(screen.getByTestId('montage-events-btn'));

    const [url] = mockRouterNavigate.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    // profile-1 (the mocked useCurrentProfile) was never seeded, so a watermark
    // resolved from it would produce no startDateTime at all.
    expect(params.get('startDateTime')).toBe('2026-07-10T08:49:38');
  });
});

/**
 * The alarm tint was the only conveyance of an alarming monitor, and it is an
 * animation. The app-wide reduced-motion rule caps every animation at one
 * 0.01ms iteration, freezing this one on its transparent 0% frame, so under
 * reduced motion the alarm showed nothing at all and a screen reader was
 * never told either. Refs #392 P8-2. The CSS half is covered by the
 * reduced-motion rule in index.css; this covers the announcement.
 */
describe('MontageMonitor alarm state is conveyed without animation', () => {
  const renderTile = () =>
    render(
      <MontageMonitor
        monitor={mockMonitorForAlarm}
        status={mockStatusForAlarm}
        currentProfile={mockProfileForAlarm}
        accessToken="test-token"
        navigate={vi.fn()}
      />
    );

  const mockMonitorForAlarm = {
    Id: '1', Name: 'Front Door', Width: '1920', Height: '1080', Orientation: '0',
    Function: 'Modect', Capturing: 'Always', Analysing: 'Always', Enabled: '1',
  } as Monitor;
  const mockStatusForAlarm = {
    MonitorId: '1', Status: 'Connected', CaptureFPS: '15.00', AnalysisFPS: '10.00',
  } as MonitorStatus;
  const mockProfileForAlarm = {
    id: asProfileId('profile-1'), name: 'Test Profile', apiUrl: 'https://test.com',
    portalUrl: 'https://test.com', cgiUrl: 'https://test.com/cgi-bin',
    isDefault: false, createdAt: Date.now(),
  } as Profile;

  const seedEvent = (receivedAt: number) => {
    (useNotificationStore.getState() as { profileEvents: Record<string, unknown[]> }).profileEvents = {
      'profile-1': [{ MonitorId: '1', receivedAt }],
    };
  };

  beforeEach(() => {
    useSettingsStore.setState({
      profileSettings: { 'profile-1': { ...DEFAULT_SETTINGS, viewMode: 'streaming' } },
    });
    useMonitorSeenStore.setState({ profileWatermarks: {} });
  });

  afterEach(() => {
    (useNotificationStore.getState() as { profileEvents: Record<string, unknown[]> }).profileEvents = {};
  });

  it('announces the alarm to a screen reader, not only as a tint', async () => {
    seedEvent(Date.now() - 60_000); // pre-existing: seeds lastSeen, no pulse
    const { rerender } = renderTile();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    seedEvent(Date.now()); // fresh alarm
    rerender(
      <MontageMonitor
        monitor={mockMonitorForAlarm}
        status={mockStatusForAlarm}
        currentProfile={mockProfileForAlarm}
        accessToken="test-token"
        navigate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('montage.alarm_status');
    });
  });
});
