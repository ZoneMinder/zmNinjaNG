import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventListView } from '../EventListView';
import type { EventData } from '../../../api/types';

// Virtualizer stub that renders a 2-row window regardless of count.
// Asserting on the window proves EventListView renders from
// getVirtualItems() instead of mapping the full events array.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const visible = Math.min(count, 2);
    return {
      getTotalSize: () => count * 140,
      getVirtualItems: () =>
        Array.from({ length: visible }, (_, index) => ({ index, key: index, size: 140, start: index * 140 })),
      measureElement: () => {},
      options: { scrollMargin: 0 },
    };
  },
}));

vi.mock('../EventCard', () => ({
  EventCard: ({ event }: { event: { Id: string } }) => <div data-testid="event-card">{event.Id}</div>,
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-1', portalUrl: 'https://portal.test' },
    settings: { thumbnailFallbackChain: [] },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const makeEvents = (count: number): EventData[] =>
  Array.from({ length: count }, (_, i) => ({
    Event: {
      Id: `${i}`,
      MonitorId: '1',
      Name: `Event ${i}`,
    },
  })) as unknown as EventData[];

const baseProps = {
  monitors: [],
  thumbnailFit: 'contain' as const,
  portalUrl: 'https://portal.test',
  batchSize: 50,
  isLoadingMore: false,
  onLoadMore: vi.fn(),
  scrollRef: { current: null },
};

describe('EventListView', () => {
  it('renders only the rows in the virtualizer window', () => {
    render(<EventListView {...baseProps} events={makeEvents(50)} totalCount={100} onLoadMore={vi.fn()} />);

    const cards = screen.getAllByTestId('event-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('0');
    expect(cards[1]).toHaveTextContent('1');
  });

  it('keeps the Load More button working below the virtualized list', async () => {
    const onLoadMore = vi.fn();
    render(<EventListView {...baseProps} events={makeEvents(50)} totalCount={100} onLoadMore={onLoadMore} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('events-load-more'));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('hides Load More when all events are loaded', () => {
    render(<EventListView {...baseProps} events={makeEvents(2)} totalCount={2} onLoadMore={vi.fn()} />);

    expect(screen.getAllByTestId('event-card')).toHaveLength(2);
    expect(screen.queryByTestId('events-load-more')).not.toBeInTheDocument();
  });
});
