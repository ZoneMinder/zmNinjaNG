/**
 * TimelineScrubber owning-profile wiring (refs #337 Task 2/3).
 *
 * All mode overwrites a canvas event's `monitorId` with the composite
 * `${profileId}:${monitorId}` key (see Timeline.tsx) so the renderer's
 * event->row matching doesn't collide across two profiles' servers. The
 * scrubber must undo that for its own purposes:
 *  - the preview thumbnail must resolve the OWNING profile's portal/token
 *    and the REAL (bare) monitor id, never the composite key or the
 *    current profile.
 *  - a tap must hand the owning profileId back to the caller directly from
 *    the tapped event object, not via a reverse by-id lookup (which breaks
 *    on colliding event ids across two profiles - the carried debt from the
 *    Phase 3 re-review).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TimelineScrubber } from '../TimelineScrubber';

vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtTimeShort: () => '00:00', fmtDateTime: () => 'now' }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useProfileById: (profileId?: string) => ({
    profile: profileId
      ? { id: profileId, portalUrl: `https://${profileId}.test` }
      : { id: 'current-profile', portalUrl: 'https://current-profile.test' },
    settings: { thumbnailFallbackChain: [], forceDisableMultiPort: false, hoverPreview: { timeline: false } },
  }),
}));

vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: (profileId?: string) => ({
    token: profileId ? `${profileId}-token` : 'current-profile-token',
    isFresh: true,
  }),
}));

const getQueryDataMock = vi.fn(() => undefined);
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: getQueryDataMock }),
}));

const buildThumbnailChainForEventMock = vi.fn((..._args: unknown[]) => ['https://thumb.test/1']);
vi.mock('../../../lib/event/thumbnail-chain', () => ({
  buildThumbnailChainForEvent: (...args: unknown[]) => buildThumbnailChainForEventMock(...args),
}));

vi.mock('../../events/EventThumbnail', () => ({
  EventThumbnail: () => <div data-testid="scrubber-thumb-img" />,
}));

const TRACK_WIDTH = 300;

function stubTrackRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: TRACK_WIDTH,
    height: 32,
    top: 0,
    left: 0,
    right: TRACK_WIDTH,
    bottom: 32,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
}

// A collision event: All mode composed this monitorId as the composite
// `${profileId}:${monitorId}` key (Timeline.tsx's canvasEvents mapping);
// realMonitorId/profileId are carried alongside for consumers that need the
// real values back.
const collisionEvent = {
  id: 'dup1',
  monitorId: 'profile-b:7',
  realMonitorId: '7',
  profileId: 'profile-b',
  profileChip: 'Office',
  startMs: 400,
  endMs: 600,
  cause: 'Motion',
  alarmRatio: 0,
  notes: '',
};

describe('TimelineScrubber owning-profile wiring (refs #337 Task 2/3)', () => {
  beforeEach(() => {
    buildThumbnailChainForEventMock.mockClear();
    stubTrackRect();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function openThumbnails() {
    fireEvent.mouseDown(screen.getByTestId('scrubber-track'), { clientX: 150 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }

  it("builds the preview thumbnail from the owning profile's portal and the REAL monitor id, not the composite key", () => {
    render(
      <TimelineScrubber
        events={[collisionEvent]}
        monitors={[{ id: 'profile-b:7', name: 'Back Door' }]}
        viewStartMs={0}
        viewEndMs={1000}
        onPlayheadChange={vi.fn()}
        onEventTap={vi.fn()}
      />
    );

    openThumbnails();

    expect(screen.getByTestId('scrubber-thumb-dup1')).toBeInTheDocument();
    expect(buildThumbnailChainForEventMock).toHaveBeenCalledTimes(1);
    const [monitorId, , profilePortalUrl, , , options] = buildThumbnailChainForEventMock.mock.calls[0] as [
      string, unknown, string, unknown, unknown, { profileId?: string; monitorId?: string },
    ];
    expect(monitorId).toBe('7');
    expect(profilePortalUrl).toBe('https://profile-b.test');
    expect(options.profileId).toBe('profile-b');
    expect(options.monitorId).toBe('7');
  });

  it("taps the thumbnail and hands back the owning profileId straight from the event object, not a by-id lookup", () => {
    const onEventTap = vi.fn();
    render(
      <TimelineScrubber
        events={[collisionEvent]}
        monitors={[{ id: 'profile-b:7', name: 'Back Door' }]}
        viewStartMs={0}
        viewEndMs={1000}
        onPlayheadChange={vi.fn()}
        onEventTap={onEventTap}
      />
    );

    openThumbnails();
    fireEvent.click(screen.getByTestId('scrubber-thumb-dup1'));

    expect(onEventTap).toHaveBeenCalledWith('dup1', 'profile-b');
  });

  it('single mode: no profileId/realMonitorId on the event, tap still works with profileId undefined (byte-identical)', () => {
    const onEventTap = vi.fn();
    render(
      <TimelineScrubber
        events={[{ id: 'e1', monitorId: '7', startMs: 400, endMs: 600, cause: 'Motion', alarmRatio: 0, notes: '' }]}
        monitors={[{ id: '7', name: 'Front Door' }]}
        viewStartMs={0}
        viewEndMs={1000}
        onPlayheadChange={vi.fn()}
        onEventTap={onEventTap}
      />
    );

    openThumbnails();
    fireEvent.click(screen.getByTestId('scrubber-thumb-e1'));

    expect(onEventTap).toHaveBeenCalledWith('e1', undefined);
    const [monitorId] = buildThumbnailChainForEventMock.mock.calls[0] as [string];
    expect(monitorId).toBe('7');
  });
});
