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

vi.mock('../../../hooks/useGo2RTCStream', () => ({
  useGo2RTCStream: () => ({
    state: 'connecting',
    error: null,
    activeProtocol: null,
    getVideoElement: () => null,
    retry: vi.fn(),
    stop: vi.fn(),
  }),
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
