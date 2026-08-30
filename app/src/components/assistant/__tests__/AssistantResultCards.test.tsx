/**
 * Monitor result cards carry a live preview when the answer is about a few
 * monitors, and fall back to text above ASSISTANT.maxLiveMonitorCards, since
 * every preview is a real stream (refs #264). Event cards carry the shared ZMS
 * hover/long-press preview when the surface is enabled (refs #270).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { AssistantResultCards } from '../AssistantResultCards';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';
import { DEFAULT_HOVER_PREVIEW } from '../../../stores/settings';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import type { AssistantHost, DisplayEntity } from '../../../lib/assistant/types';

const hoverPreview = { ...DEFAULT_HOVER_PREVIEW };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../hooks/useMonitors', () => ({
  useMonitors: () => ({
    monitors: [
      { Monitor: { Id: '3', Name: 'Garage', Function: 'Modect', Enabled: '1' } },
      { Monitor: { Id: '4', Name: 'Front', Function: 'Modect', Enabled: '1' } },
    ],
  }),
}));
vi.mock('../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="live-player-stub" />,
}));
// The real HoverPreview only calls renderPreview once open (hover / long
// press), which jsdom cannot produce; the stub renders it immediately so the
// descriptor the card hands the ZMS player is assertable.
vi.mock('../../ui/hover-preview', () => ({
  HoverPreview: ({ children, renderPreview }: { children: React.ReactNode; renderPreview: () => React.ReactNode }) => (
    <div data-testid="hover-preview-stub">
      {children}
      {renderPreview()}
    </div>
  ),
}));
vi.mock('../../events/EventThumbnailHoverPreview', () => ({
  EventZmsHoverPlayer: ({ descriptor }: { descriptor: { eventId: string; monitorId: string } }) => (
    <div data-testid="zms-hover-stub">{`${descriptor.eventId}@${descriptor.monitorId}`}</div>
  ),
}));

beforeEach(() => {
  seedProfiles(['p1'], { settings: { p1: { hoverPreview } } });
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

const host: AssistantHost = { navigate: vi.fn(), onActivity: vi.fn() };
const monitorCard = (id: string): DisplayEntity => ({
  kind: 'monitor',
  id,
  title: `Monitor ${id}`,
  navigatePath: `/monitors/${id}`,
});

describe('AssistantResultCards live previews', () => {
  it('renders a live preview on a monitor card whose monitor is known', () => {
    render(<AssistantResultCards entities={[monitorCard('3')]} host={host} />);
    expect(screen.getByTestId('assistant-card-monitor-live')).toBeInTheDocument();
    expect(screen.getByTestId('live-player-stub')).toBeInTheDocument();
  });

  it('renders no preview for a monitor the query does not know', () => {
    render(<AssistantResultCards entities={[monitorCard('99')]} host={host} />);
    expect(screen.queryByTestId('assistant-card-monitor-live')).not.toBeInTheDocument();
  });

  it('falls back to text cards above the live-preview cap', () => {
    const many = Array.from({ length: ASSISTANT.maxLiveMonitorCards + 1 }, (_, i) => monitorCard(String(i)));
    render(<AssistantResultCards entities={many} host={host} />);
    expect(screen.queryByTestId('assistant-card-monitor-live')).not.toBeInTheDocument();
  });
});

const eventCard = (id: string, monitorId?: string): DisplayEntity => ({
  kind: 'event',
  id,
  title: `Event ${id}`,
  navigatePath: `/events/${id}`,
  imageUrls: ['http://zm/thumb.jpg'],
  monitorId,
});

describe('AssistantResultCards event hover playback', () => {
  afterEach(() => {
    hoverPreview.assistant = DEFAULT_HOVER_PREVIEW.assistant;
  });

  it('wraps an event thumbnail in the ZMS hover preview', () => {
    render(<AssistantResultCards entities={[eventCard('77', '3')]} host={host} />);
    expect(screen.getByTestId('hover-preview-stub')).toBeInTheDocument();
    expect(screen.getByTestId('zms-hover-stub')).toHaveTextContent('77@3');
  });

  it('leaves the thumbnail bare when the surface is disabled', () => {
    hoverPreview.assistant = false;
    render(<AssistantResultCards entities={[eventCard('77', '3')]} host={host} />);
    expect(screen.queryByTestId('hover-preview-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-card-thumbnail')).toBeInTheDocument();
  });

  // A card built before the monitor id was carried (or any card without one)
  // cannot resolve the ZMS streaming port, so it stays a plain thumbnail.
  it('leaves the thumbnail bare without a monitor id', () => {
    render(<AssistantResultCards entities={[eventCard('77')]} host={host} />);
    expect(screen.queryByTestId('hover-preview-stub')).not.toBeInTheDocument();
  });
});

/**
 * Cards from a group of servers (refs #337). Two servers can both have a
 * "Front Door" and both have a monitor 3, so a card has to say which server it
 * came from, and must not borrow the pinned server's monitor to stream from.
 */
describe('AssistantResultCards across servers', () => {
  const fromServer = (entity: DisplayEntity, server: string, profileId: string): DisplayEntity => ({
    ...entity,
    server,
    profileId: profileId as DisplayEntity['profileId'],
  });

  it('names the owning server on each card', () => {
    render(
      <AssistantResultCards
        entities={[
          fromServer(eventCard('77', '3'), 'warehouse', 'p-warehouse'),
          fromServer(eventCard('77', '3'), 'cabin', 'p-cabin'),
        ]}
        host={host}
      />,
    );
    const labels = screen.getAllByTestId('assistant-card-server').map((el) => el.textContent);
    expect(labels).toEqual(['warehouse', 'cabin']);
  });

  it('renders no live preview for a monitor on another server', () => {
    // Monitor id 3 exists in the pinned server's query; this card is server
    // "cabin"'s monitor 3, a different camera entirely.
    render(<AssistantResultCards entities={[fromServer(monitorCard('3'), 'cabin', 'p-cabin')]} host={host} />);
    expect(screen.queryByTestId('assistant-card-monitor-live')).not.toBeInTheDocument();
  });

  it('still previews a card belonging to the pinned server', () => {
    render(<AssistantResultCards entities={[fromServer(monitorCard('3'), 'warehouse', 'p1')]} host={host} />);
    expect(screen.getByTestId('assistant-card-monitor-live')).toBeInTheDocument();
  });
});
