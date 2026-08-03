import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { MonitorCard } from '../MonitorCard';
import { useMonitorSeenStore } from '../../../stores/monitorSeen';
import { asProfileId } from '../../../api/types';
import type { Monitor, MonitorStatus } from '../../../api/types';

const OTHER_PROFILE_ID = asProfileId('other-profile');

vi.mock('../LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: ({ monitor }: { monitor: { Name: string } }) => (
    <div data-testid="video-player">{monitor.Name}</div>
  ),
}));

vi.mock('../MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useProfileById: () => ({
    profile: { id: 'test', portalUrl: 'https://test', cgiUrl: 'https://test/cgi', apiUrl: 'https://test/api' },
    settings: { viewMode: 'streaming', hoverPreview: { eventsList: true, eventsGrid: false, monitorsList: true, monitorsGrid: false, dashboard: true, timeline: true, notifications: true } },
  }),
  // useOpenMonitorEvents (imported by MonitorCard) reads the current profile
  // directly, independent of the profileId prop under test here.
  useCurrentProfile: () => ({
    currentProfile: { id: 'test' },
  }),
}));

const switchProfileMock = vi.fn(() => Promise.resolve());
vi.mock('../../../stores/profile', () => ({
  useProfileStore: (selector: (state: { switchProfile: typeof switchProfileMock }) => unknown) =>
    selector({ switchProfile: switchProfileMock }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    monitorCard: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../../stores/auth', () => ({
  useAuthStore: (selector: (state: { version: string }) => unknown) =>
    selector({ version: '1.38.0' }),
  useAuthSlice: () => ({ version: '1.38.0' }),
}));

describe('MonitorCard', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    switchProfileMock.mockReset();
    switchProfileMock.mockResolvedValue(undefined);
    vi.mocked(toast.error).mockClear();
    useMonitorSeenStore.setState({ profileWatermarks: {} });
  });

  it('calls settings callback when settings button is clicked', async () => {
    const user = userEvent.setup();
    const onShowSettings = vi.fn();
    const monitor = {
      Id: '1',
      Name: 'Front Door',
      Type: 'Local',
      Function: 'Monitor',
      Enabled: '1',
      Controllable: '0',
      Width: '640',
      Height: '480',
    } as Monitor;
    const status = {
      MonitorId: '1',
      Status: 'Connected',
      CaptureFPS: '10',
    } as MonitorStatus;

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={3}
        onShowSettings={onShowSettings}
      />
    );

    await user.click(screen.getByTestId('monitor-settings-button'));

    expect(onShowSettings).toHaveBeenCalledWith(
      expect.objectContaining({ Id: '1', Name: 'Front Door' }),
      undefined
    );
  });

  const monitor = {
    Id: '1',
    Name: 'Front Door',
    Type: 'Local',
    Function: 'Monitor',
    Enabled: '1',
    Controllable: '0',
    Width: '640',
    Height: '480',
  } as Monitor;
  const status = {
    MonitorId: '1',
    Status: 'Connected',
    CaptureFPS: '10',
  } as MonitorStatus;

  it('navigates with the watermark-derived startDateTime when there are new events', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('test', '1', '2026-07-10 08:49:37');

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={2}
        newestEventAt="2026-07-10 09:15:00"
        onShowSettings={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [url] = mockNavigate.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('monitorId')).toBe('1');
    expect(params.get('startDateTime')).toBe('2026-07-10T08:49:38');
  });

  it('navigates without a date filter when there are no new events', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('test', '1', '2026-07-10 08:49:37');

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={undefined}
        onShowSettings={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('navigates without a date filter when the monitor was seeded with zero events', async () => {
    const user = userEvent.setup();
    useMonitorSeenStore.getState().seed('test', '1', null);

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        newEventCount={5}
        newestEventAt="2026-07-10 09:15:00"
        onShowSettings={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('monitor-events-button'));

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('renders the profile chip when profileChip is provided (All mode)', () => {
    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        onShowSettings={vi.fn()}
        profileId={OTHER_PROFILE_ID}
        profileChip="Office"
      />
    );

    expect(screen.getByTestId('monitor-profile-chip')).toHaveTextContent('Office');
  });

  it('does not render a profile chip in single mode', () => {
    render(<MonitorCard monitor={monitor} status={status} onShowSettings={vi.fn()} />);

    expect(screen.queryByTestId('monitor-profile-chip')).not.toBeInTheDocument();
  });

  it('switches to the owning profile before navigating to the detail page (All mode)', async () => {
    const user = userEvent.setup();

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        onShowSettings={vi.fn()}
        profileId={OTHER_PROFILE_ID}
        profileChip="Office"
      />
    );

    await user.click(screen.getByTestId('monitor-player'));

    expect(switchProfileMock).toHaveBeenCalledWith(OTHER_PROFILE_ID);
    expect(mockNavigate).toHaveBeenCalledWith('/monitors/1', { state: { from: '/monitors' } });
  });

  it('shows a toast and does not navigate when switching to the owning profile fails', async () => {
    const user = userEvent.setup();
    switchProfileMock.mockRejectedValueOnce(new Error('switch failed'));

    render(
      <MonitorCard
        monitor={monitor}
        status={status}
        onShowSettings={vi.fn()}
        profileId={OTHER_PROFILE_ID}
        profileChip="Office"
      />
    );

    await user.click(screen.getByTestId('monitor-player'));

    expect(switchProfileMock).toHaveBeenCalledWith(OTHER_PROFILE_ID);
    expect(toast.error).toHaveBeenCalledWith('profiles.switch_failed');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
