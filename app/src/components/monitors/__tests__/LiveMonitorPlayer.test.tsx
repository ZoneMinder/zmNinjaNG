/**
 * LiveMonitorPlayer MJPEG recovery tests.
 *
 * Regression coverage for refs #150: when the Electron window is occluded the
 * MJPEG <img> connection drops and onError latches mjpegError=true, which
 * unmounts the <img>. The visibility/focus resume then mints a new connkey
 * (new imageSrc), and the tile must re-render the <img> instead of staying on
 * the VideoOff placeholder. Before the fix, mjpegError was never cleared on a
 * connkey change, so the feed only recovered on a full remount (route change).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveMonitorPlayer } from '../LiveMonitorPlayer';
import type { Monitor, Profile } from '../../../api/types';

let mockMjpegReturn: {
  streamUrl: string;
  imageSrc: string;
  imgRef: { current: HTMLImageElement | null };
  regenerateConnection: () => void;
};

vi.mock('../../../hooks/useMonitorStream', () => ({
  useMonitorStream: () => mockMjpegReturn,
}));

const go2rtc = vi.hoisted(() => ({
  state: 'connecting' as string,
  optionsLog: [] as Array<{ monitorId: string; enabled?: boolean }>,
}));

vi.mock('../../../hooks/useGo2RTCStream', () => ({
  useGo2RTCStream: (opts: { monitorId: string; enabled?: boolean }) => {
    go2rtc.optionsLog.push(opts);
    return {
      state: go2rtc.state,
      error: go2rtc.state === 'error' ? 'Go2RTC WebSocket connection failed' : null,
      activeProtocol: null,
      getVideoElement: () => null,
      retry: vi.fn(),
      stop: vi.fn(),
    };
  },
}));

vi.mock('../../../hooks/useVisibilityResume', () => ({
  useVisibilityResume: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/logger', () => ({
  log: { videoPlayer: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

vi.mock('../../../stores/settings', () => ({
  useSettingsStore: () => undefined,
}));

const monitor = { Id: '1', Name: 'Front Door', Go2RTCEnabled: false } as unknown as Monitor;
const profile = {
  id: 'profile-1',
  name: 'Test',
  apiUrl: 'https://t',
  portalUrl: 'https://t',
  cgiUrl: 'https://t/cgi-bin',
  isDefault: false,
  createdAt: 0,
} as Profile;

describe('LiveMonitorPlayer MJPEG recovery', () => {
  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
    };
  });

  it('re-renders the MJPEG <img> after an error once a new connkey arrives', () => {
    const { rerender } = render(<LiveMonitorPlayer monitor={monitor} profile={profile} />);

    // Stream is up: the <img> is mounted.
    expect(screen.getByTestId('video-player-mjpeg')).toHaveAttribute(
      'src',
      'https://t/stream?connkey=1',
    );

    // Occlusion drops the connection -> the <img> errors and unmounts.
    fireEvent.error(screen.getByTestId('video-player-mjpeg'));
    expect(screen.queryByTestId('video-player-mjpeg')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-player-loading')).toBeInTheDocument();

    // Visibility/focus resume mints a fresh connkey (new imageSrc).
    mockMjpegReturn = {
      ...mockMjpegReturn,
      streamUrl: 'https://t/stream?connkey=2',
      imageSrc: 'https://t/stream?connkey=2',
    };
    rerender(<LiveMonitorPlayer monitor={monitor} profile={profile} />);

    // The tile must recover with the new stream, not stay on VideoOff.
    expect(screen.getByTestId('video-player-mjpeg')).toHaveAttribute(
      'src',
      'https://t/stream?connkey=2',
    );
  });
});

describe('LiveMonitorPlayer Go2RTC failure cache scoping', () => {
  const go2rtcProfile = { ...profile, go2rtcUrl: 'https://t/go2rtc' } as Profile;

  beforeEach(() => {
    mockMjpegReturn = {
      streamUrl: 'https://t/stream?connkey=1',
      imageSrc: 'https://t/stream?connkey=1',
      imgRef: { current: null },
      regenerateConnection: vi.fn(),
    };
    go2rtc.state = 'connecting';
    go2rtc.optionsLog = [];
  });

  // Whether the latest mount asked the Go2RTC hook to connect for this monitor.
  const latestEnabled = (monitorId: string): boolean | undefined =>
    [...go2rtc.optionsLog].reverse().find((o) => o.monitorId === monitorId)?.enabled;

  it('single-monitor view does not inherit a montage-recorded Go2RTC failure', () => {
    const rtcMonitor = { Id: 'cache-a', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;

    // A montage tile fails Go2RTC and records the failure in the shared cache.
    go2rtc.state = 'error';
    const montage = render(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />);
    montage.unmount();

    // The single-monitor view opts out of the shared cache: it must still try
    // Go2RTC even though the montage run just marked this monitor failed.
    go2rtc.state = 'connecting';
    render(
      <LiveMonitorPlayer
        monitor={rtcMonitor}
        profile={go2rtcProfile}
        bypassGo2rtcFailureCache
        forceViewMode="streaming"
      />,
    );

    expect(latestEnabled('cache-a')).toBe(true);
  });

  it('montage tiles still inherit the shared Go2RTC failure cache', () => {
    const rtcMonitor = { Id: 'cache-b', Name: 'Cam', Go2RTCEnabled: true } as unknown as Monitor;

    // First montage tile fails and records the failure.
    go2rtc.state = 'error';
    const first = render(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />);
    first.unmount();

    // A subsequent montage tile for the same monitor skips Go2RTC (MJPEG fallback).
    go2rtc.state = 'connecting';
    render(<LiveMonitorPlayer monitor={rtcMonitor} profile={go2rtcProfile} />);

    expect(latestEnabled('cache-b')).toBe(false);
  });
});
