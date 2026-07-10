import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EventMontageView } from '../EventMontageView';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { RETURN_FLASH_MS } from '../../../lib/zmninja-ng-constants';
import type { EventData } from '../../../api/types';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: (d: Date) => d.toISOString() }),
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    settings: { thumbnailFallbackChain: [], hoverPreview: { eventsGrid: false } },
  }),
}));

vi.mock('../EventThumbnail', () => ({ EventThumbnail: () => <div data-testid="event-thumbnail" /> }));

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

function renderEvents(events: EventData[]) {
  return render(
    <EventMontageView
      events={events}
      monitors={[]}
      gridCols={3}
      thumbnailFit="contain"
      portalUrl="https://zm.example.test"
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
