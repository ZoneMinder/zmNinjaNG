/**
 * MontageMonitor Tests
 *
 * Basic tests for the MontageMonitor component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { MontageMonitor } from '../MontageMonitor';
import type { Monitor, MonitorStatus, Profile } from '../../../api/types';
import { asProfileId } from '../../../api/types';
import { useMonitorStore } from '../../../stores/monitors';
import { useSettingsStore } from '../../../stores/settings';
import { useMonitorSeenStore } from '../../../stores/monitorSeen';
import { useNotificationStore } from '../../../stores/notifications';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

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

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, montageMonitor: vi.fn(), videoPlayer: vi.fn(), monitor: vi.fn() } };
});

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
    muted,
  }: {
    reduceStream?: boolean;
    paused?: boolean;
    forceViewMode?: string;
    muted?: boolean;
  }) => (
    <div
      data-testid="video-player"
      data-reduce-stream={String(reduceStream ?? false)}
      data-paused={String(paused ?? false)}
      data-force-view-mode={forceViewMode ?? 'none'}
      data-muted={String(muted ?? true)}
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

    seedProfiles([makeProfile('profile-1')], {
      settings: { 'profile-1': { viewMode: 'streaming', streamScale: 50, streamMaxFps: 5 } },
    });

    useMonitorSeenStore.setState({ profileWatermarks: {} });
    useNotificationStore.setState({ profileEvents: {} });
    mockRouterNavigate.mockClear();

    vi.clearAllMocks();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useNotificationStore.setState({ profileEvents: {} });
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

  it('remembers an unmuted Go2RTC monitor across remounts (refs #463)', async () => {
    const user = userEvent.setup();
    const rtcMonitor = { ...mockMonitor, Go2RTCEnabled: true } as Monitor;
    const rtcProfile = { ...mockProfile, go2rtcUrl: 'https://go2rtc.test' };
    const tile = (
      <MontageMonitor
        monitor={rtcMonitor}
        status={mockStatus}
        currentProfile={rtcProfile}
        accessToken="test-token"
        navigate={mockNavigate}
      />
    );

    const { unmount } = render(tile);
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-muted', 'true');
    await user.click(screen.getByTestId('montage-volume-btn'));
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-muted', 'false');
    expect(useSettingsStore.getState().getProfileSettings(rtcProfile.id).unmutedMonitorIds).toEqual(['1']);
    unmount();

    render(tile);
    expect(screen.getByTestId('video-player')).toHaveAttribute('data-muted', 'false');
    expect(screen.getByTestId('montage-volume-btn')).toHaveAttribute('aria-label', 'monitor_detail.mute');
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
    useNotificationStore.setState({
      profileEvents: {
        'profile-1': [{
          MonitorId: 1,
          MonitorName: 'Front Door',
          EventId: 1,
          Cause: 'Motion',
          Name: 'Front Door',
          receivedAt,
          read: false,
          source: 'poll',
        }],
      },
    });
  };

  beforeEach(() => {
    seedProfiles([makeProfile('profile-1')], { settings: { 'profile-1': { viewMode: 'streaming' } } });
    useMonitorSeenStore.setState({ profileWatermarks: {} });
  });

  afterEach(() => {
    useNotificationStore.setState({ profileEvents: {} });
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('announces the alarm to a screen reader, not only as a tint', async () => {
    seedEvent(Date.now() - 60_000); // pre-existing: seeds lastSeen, no pulse
    const { rerender } = renderTile();
    expect(screen.queryByRole('status')).toBeNull();

    act(() => seedEvent(Date.now())); // fresh alarm
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
