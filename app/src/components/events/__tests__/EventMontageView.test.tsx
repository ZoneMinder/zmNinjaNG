import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EventMontageView } from '../EventMontageView';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { RETURN_FLASH_MS } from '../../../lib/zmninja-ng-constants';
import { downloadEventVideo } from '../../../services/download';
import type { EventData } from '../../../api/types';
import type { ScopedEventItem } from '../EventListView';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: (d: Date) => d.toISOString() }),
}));

// Per-row owning-profile resolution (EventItem pattern, refs #337 Task 2):
// useProfileById/useFreshAccessToken return profile-specific portal/token
// when given a profileId, and the current-profile defaults otherwise.
const THUMBNAIL_CHAIN = [{ type: 'snapshot' as const, enabled: true }];

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    settings: { thumbnailFallbackChain: THUMBNAIL_CHAIN, hoverPreview: { eventsGrid: false } },
  }),
  useProfileById: (profileId?: string) => ({
    profile: profileId ? { id: profileId, portalUrl: `https://${profileId}.test` } : null,
    settings: { thumbnailFallbackChain: THUMBNAIL_CHAIN, forceDisableMultiPort: false },
  }),
}));

vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: (profileId?: string) => ({
    token: profileId ? `${profileId}-token` : undefined,
    isFresh: true,
  }),
}));

vi.mock('../EventThumbnail', () => ({
  EventThumbnail: ({ urls }: { urls: string[] }) => (
    <div data-testid="event-thumbnail" data-url={urls[0] ?? ''} />
  ),
}));

vi.mock('../EventThumbnailHoverPreview', () => ({
  EventThumbnailHoverPreview: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../services/download', () => ({ downloadEventVideo: vi.fn() }));

// EventData is a wrapper: { Event: {...} }. These are the inner Event fields.
const baseEventFields = {
  Id: '101',
  MonitorId: '1',
  StorageId: null,
  SecondaryStorageId: null,
  Name: 'Motion Event',
  Cause: 'Motion',
  StartDateTime: '2024-01-01 10:00:00',
  EndDateTime: null,
  Width: '640',
  Height: '480',
  Length: '12',
  Frames: '120',
  AlarmFrames: '5',
  AlarmFrameId: '1',
  MaxScoreFrameId: '2',
  DefaultVideo: null,
  SaveJPEGs: '0',
  TotScore: '10',
  AvgScore: '1',
  MaxScore: '3',
  Archived: '0',
  Videoed: '0',
  Uploaded: '0',
  Emailed: '0',
  Messaged: '0',
  Executed: '0',
  Notes: null,
  StateId: null,
  Orientation: null,
  DiskSpace: null,
  Scheme: null,
};

// ZoneMinder StartDateTime format: 'YYYY-MM-DD HH:mm:ss' (space, local time).
function toZmDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function eventWithId(id: string): EventData {
  return { Event: { ...baseEventFields, Id: id } } as unknown as EventData;
}

/** A ScopedEventItem tagged with an owning profile, as Events.tsx builds them
 *  in All mode (refs #337 Task 2). */
function scopedEvent(id: string, profileId: string, profileChip: string, overrides: Partial<typeof baseEventFields> = {}): ScopedEventItem {
  return {
    Event: { ...baseEventFields, ...overrides, Id: id },
    profileId,
    profileChip,
  } as unknown as ScopedEventItem;
}

function renderEvents(events: EventData[], monitors: Array<{ Monitor: { Id: string; ServerId?: string | null }; profileId?: string }> = []) {
  return render(
    <EventMontageView
      events={events as ScopedEventItem[]}
      monitors={monitors as never}
      gridCols={3}
      thumbnailFit="contain"
      portalUrl="https://zm.example.test"
      accessToken="current-profile-token"
      batchSize={20}
      onLoadMore={vi.fn()}
      eventFilters={{ monitorId: '1' } as never}
    />
  );
}

function renderMontage(startDateTime: string) {
  return renderEvents([{ Event: { ...baseEventFields, StartDateTime: startDateTime } } as unknown as EventData]);
}

// Reset before, not after: Testing Library unmounts between tests, so by the
// time this runs no tile is mounted to re-render outside act().
beforeEach(() => {
  navigate.mockClear();
  useReturnHighlightStore.setState({ lastViewedEventId: null });
});

describe('EventMontageView relative time (grid view)', () => {
  it('shows a relative-time label for a recent event', () => {
    renderMontage(toZmDate(new Date(Date.now() - 40 * 60_000)));
    expect(screen.getByTestId('event-montage-relative-time')).toBeInTheDocument();
  });

  it('hides the relative-time label for an event older than the window', () => {
    renderMontage(toZmDate(new Date(Date.now() - 30 * 24 * 60 * 60_000)));
    expect(screen.queryByTestId('event-montage-relative-time')).not.toBeInTheDocument();
  });
});

describe('EventMontageView return highlight (grid view)', () => {
  it('records the opened event and navigates when a tile is clicked', () => {
    renderEvents([eventWithId('101')]);

    fireEvent.click(screen.getByTestId('event-montage-tile'));

    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('101');
    expect(navigate).toHaveBeenCalledWith('/events/101', {
      state: { from: '/events', eventFilters: { monitorId: '1' } },
    });
  });

  it('flashes the arrow only on the tile the user returned from', () => {
    useReturnHighlightStore.setState({ lastViewedEventId: '102' });

    renderEvents([eventWithId('101'), eventWithId('102'), eventWithId('103')]);

    const arrows = screen.getAllByTestId('return-flash-indicator');
    expect(arrows).toHaveLength(1);
    // The arrow is a sibling of the Card, not a child: the Card clips its
    // overflow, and the arrow has to straddle the tile's top edge. It must
    // still belong to the returned-from tile's wrapper.
    const wrapper = arrows[0].parentElement;
    expect(wrapper?.querySelector('[data-event-id="102"]')).not.toBeNull();
    expect(wrapper?.querySelector('[data-event-id="101"]')).toBeNull();
  });

  it('clears the arrow after RETURN_FLASH_MS', () => {
    vi.useFakeTimers();
    try {
      useReturnHighlightStore.setState({ lastViewedEventId: '101' });
      renderEvents([eventWithId('101')]);
      expect(screen.getByTestId('return-flash-indicator')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(RETURN_FLASH_MS + 1);
      });

      expect(screen.queryByTestId('return-flash-indicator')).not.toBeInTheDocument();
      expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// All-mode per-tile owning-profile wiring (refs #337 Task 2): each tile must
// build ITS OWN event's owning profile's portal URL and token, exactly like
// EventListView's EventItem, rather than the page-level current-profile
// defaults (which reflect no/whatever profile is current in All mode).
describe('EventMontageView all-mode owning-profile wiring (refs #337 Task 2)', () => {
  it("builds profile B's tile with profile B's portal and token while the page-level default is profile A's", () => {
    renderEvents([scopedEvent('201', 'profile-b', 'Office')]);

    const thumb = screen.getByTestId('event-thumbnail');
    const url = decodeURIComponent(thumb.getAttribute('data-url') ?? '');
    expect(url).toContain('https://profile-b.test');
    expect(url).not.toContain('zm.example.test');
  });

  it('renders the owning profile chip with the shared list-view testid', () => {
    renderEvents([scopedEvent('202', 'profile-b', 'Office')]);

    expect(screen.getByTestId('event-profile-chip')).toHaveTextContent('Office');
  });

  it('renders no profile chip in single mode (profileId undefined)', () => {
    renderEvents([eventWithId('203')]);

    expect(screen.queryByTestId('event-profile-chip')).not.toBeInTheDocument();
  });

  it("the video download button uses the tile's own owning-profile portal and token, not the page-level default", async () => {
    renderEvents([scopedEvent('204', 'profile-b', 'Office', { Videoed: '1' })]);

    fireEvent.click(screen.getByTestId('event-download-button'));
    // The click handler is async (haptics await before calling
    // downloadEventVideo); flush the microtask queue.
    await act(async () => {});

    expect(downloadEventVideo).toHaveBeenCalledTimes(1);
    const [portalUrl, eventId, , accessToken] = vi.mocked(downloadEventVideo).mock.calls[0];
    expect(portalUrl).toContain('https://profile-b.test');
    expect(eventId).toBe('204');
    expect(accessToken).toBe('profile-b-token');
  });

  it('single-mode tile still uses the page-level portal and token unchanged (byte-identical)', () => {
    renderEvents([eventWithId('205')]);

    const thumb = screen.getByTestId('event-thumbnail');
    const url = decodeURIComponent(thumb.getAttribute('data-url') ?? '');
    expect(url).toContain('https://zm.example.test');
  });
});
