/**
 * EventDetail Page Tests
 *
 * Covers the favorite toggle only. `isFavorited` is a store getter whose function
 * reference never changes, so a subscription that returns it verbatim is shallow-equal
 * forever and the star never flips. These tests click the real button against the real
 * favorites store and assert the DOM and the toast both follow the new state.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventDetail from '../EventDetail';
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import { useSettingsStore } from '../../stores/settings';

const useQueryMock = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();

// Mutable knobs read by the mocks below so individual tests can vary the
// continuous-play setting and the next-event result (#250).
const h = vi.hoisted(() => ({
  settings: {
    thumbnailFallbackChain: 'snapshot',
    forceDisableMultiPort: false,
    eventVideoAutoplay: false,
    eventContinuousPlay: false,
    eventPlaybackRate: 1,
  } as Record<string, unknown>,
  goToNextEvent: vi.fn(),
  locationState: {} as Record<string, unknown>,
  translate: vi.fn((key: string) => key),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => useQueryMock(options),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: vi.fn(),
    info: (message: string) => toastInfo(message),
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '101' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: h.locationState }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: h.translate, i18n: { language: 'en' } }),
}));

// EventDetail pulls in modules that each use their own log.* helper; a Proxy answers
// every component name with a no-op instead of listing them.
vi.mock('../../lib/logger', () => ({
  log: new Proxy({}, { get: () => vi.fn() }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../../lib/platform', () => ({
  Platform: { isNative: false, isTVDevice: false },
}));

vi.mock('../../api/events', () => ({
  getEvent: vi.fn(),
  getEventVideoUrl: vi.fn(() => 'https://example.test/video.mp4'),
  getEventImageUrl: vi.fn(() => 'https://example.test/thumb.jpg'),
  setEventArchived: vi.fn(),
}));

vi.mock('../../api/monitors', () => ({ getMonitor: vi.fn() }));

vi.mock('../../services/download', () => ({ downloadEventVideo: vi.fn() }));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-1', portalUrl: 'https://portal.test', apiUrl: 'https://api.test' },
    settings: h.settings,
    hasProfile: true,
  }),
}));

vi.mock('../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: 'token-1', isFresh: true }),
}));

vi.mock('../../hooks/useEventTags', () => ({
  useEventTagMapping: () => ({ getTagsForEvent: () => [] }),
}));

vi.mock('../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({
    fmtDate: () => '2024-01-01',
    fmtTime: () => '10:00:00',
    fmtDateTime: () => '2024-01-01 10:00:00',
  }),
}));

vi.mock('../../hooks/useTvMode', () => ({ useTvMode: () => ({ isTvMode: false }) }));

vi.mock('../../hooks/useEventNavigation', () => ({
  useEventNavigation: () => ({
    goToPrevEvent: vi.fn(),
    goToNextEvent: h.goToNextEvent,
    isLoadingPrev: false,
    isLoadingNext: false,
  }),
}));

vi.mock('../../hooks/useServerUrls', () => ({
  useServerUrls: () => ({ portalPath: 'https://portal.test/index.php' }),
}));

vi.mock('../../hooks/useZoomPan', () => ({
  useZoomPan: () => ({
    ref: { current: null },
    innerRef: { current: null },
    scale: 1,
    isZoomed: false,
    reset: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    panLeft: vi.fn(),
    panRight: vi.fn(),
    panUp: vi.fn(),
    panDown: vi.fn(),
  }),
}));

vi.mock('../../components/ui/zoom-controls', () => ({
  ZoomControls: () => <div data-testid="zoom-controls" />,
}));

vi.mock('../../components/events/Mp4EventPlayer', () => ({
  Mp4EventPlayer: ({ onEnded }: { onEnded?: () => void }) => (
    <div data-testid="mp4-player">
      <button data-testid="mp4-fire-ended" onClick={() => onEnded?.()} />
    </div>
  ),
}));

vi.mock('../../components/events/ZmsEventPlayer', () => ({
  ZmsEventPlayer: ({ onEnded }: { onEnded?: () => void }) => (
    <div data-testid="zms-player">
      <button data-testid="zms-fire-ended" onClick={() => onEnded?.()} />
    </div>
  ),
}));

const event = {
  Event: {
    Id: '101',
    MonitorId: '1',
    StorageId: null,
    Name: 'Motion Event',
    Cause: 'Motion',
    Notes: '',
    StartDateTime: '2024-01-01 10:00:00',
    EndDateTime: '2024-01-01 10:00:12',
    Width: '640',
    Height: '480',
    Orientation: 'ROTATE_0',
    Length: '12',
    Frames: '120',
    AlarmFrames: '5',
    AlarmFrameId: '1',
    MaxScoreFrameId: '2',
    MaxScore: '30',
    AvgScore: '10',
    DiskSpace: '1024',
    DefaultVideo: '',
    Videoed: '0',
    SaveJPEGs: '3',
    Archived: '0',
  },
};

const monitorData = { Monitor: { Id: '1', Name: 'Front Door', Width: '640', Height: '480', Orientation: 'ROTATE_0' } };

function favoriteButton() {
  return screen.getByTestId('event-detail-favorite-button');
}

function star() {
  return favoriteButton().querySelector('svg') as SVGElement;
}

describe('EventDetail favorite toggle', () => {
  beforeEach(() => {
    useEventFavoritesStore.setState({ profileFavorites: {} });
    toastSuccess.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'event') {
        return { data: event, isLoading: false, error: null };
      }
      if (queryKey[0] === 'monitor') {
        return { data: monitorData, isLoading: false, error: null };
      }
      return { data: null, isLoading: false, error: null };
    });
  });

  it('starts unfavorited when the store has no entry for the event', () => {
    render(<EventDetail />);
    expect(star()).not.toHaveClass('fill-current');
  });

  it('fills the star and records the favorite when the button is clicked', () => {
    render(<EventDetail />);

    fireEvent.click(favoriteButton());

    expect(star()).toHaveClass('fill-current');
    expect(useEventFavoritesStore.getState().profileFavorites['profile-1']).toEqual(['101']);
    expect(toastSuccess).toHaveBeenCalledWith('events.added_to_favorites');
  });

  it('empties the star and reports removal on a second click', () => {
    render(<EventDetail />);

    fireEvent.click(favoriteButton());
    toastSuccess.mockClear();
    fireEvent.click(favoriteButton());

    expect(star()).not.toHaveClass('fill-current');
    expect(useEventFavoritesStore.getState().profileFavorites['profile-1']).toEqual([]);
    expect(toastSuccess).toHaveBeenCalledWith('events.removed_from_favorites');
  });

  it('re-renders when the favorite is set from outside the component', () => {
    render(<EventDetail />);
    expect(star()).not.toHaveClass('fill-current');

    act(() => useEventFavoritesStore.getState().addFavorite('profile-1', '101'));

    expect(star()).toHaveClass('fill-current');
  });
});

describe('EventDetail continuous playback (#250)', () => {
  beforeEach(() => {
    toastInfo.mockClear();
    h.settings.eventContinuousPlay = false;
    h.goToNextEvent.mockReset();
    h.locationState = {};
    h.translate.mockClear();
    useSettingsStore.setState({ profileSettings: {} });
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'event') return { data: event, isLoading: false, error: null };
      if (queryKey[0] === 'monitor') return { data: monitorData, isLoading: false, error: null };
      return { data: null, isLoading: false, error: null };
    });
  });

  it('toggling continuous play persists the setting for the profile', () => {
    render(<EventDetail />);
    fireEvent.click(screen.getByTestId('event-detail-continuous-play'));
    expect(
      useSettingsStore.getState().getProfileSettings('profile-1').eventContinuousPlay
    ).toBe(true);
  });

  it('advances to the next event when a video ends and continuous play is on', async () => {
    h.settings.eventContinuousPlay = true;
    h.goToNextEvent.mockResolvedValue(true);
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('zms-fire-ended'));

    await waitFor(() => expect(h.goToNextEvent).toHaveBeenCalledTimes(1));
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('announces the monitor and time after an automatic advance', async () => {
    h.locationState = { continuousPlayback: true };
    render(<EventDetail />);

    await waitFor(() => expect(h.translate).toHaveBeenCalledWith(
      'event_detail.continuous_playing',
      { monitor: 'Front Door', id: '1' },
    ));
    render(toastInfo.mock.calls[0][0]);
    expect(screen.getByText('2024-01-01 10:00:00')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('shows "no more videos" and stops when there is no next event', async () => {
    h.settings.eventContinuousPlay = true;
    h.goToNextEvent.mockResolvedValue(false);
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('zms-fire-ended'));

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('event_detail.no_more_videos'));
  });

  it('does not advance when continuous play is off', () => {
    h.settings.eventContinuousPlay = false;
    render(<EventDetail />);

    fireEvent.click(screen.getByTestId('zms-fire-ended'));

    expect(h.goToNextEvent).not.toHaveBeenCalled();
  });
});
