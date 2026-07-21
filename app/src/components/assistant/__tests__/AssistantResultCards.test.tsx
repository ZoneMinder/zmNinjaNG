/**
 * Monitor result cards carry a live preview when the answer is about a few
 * monitors, and fall back to text above ASSISTANT.maxLiveMonitorCards, since
 * every preview is a real stream (refs #264).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssistantResultCards } from '../AssistantResultCards';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';
import type { AssistantHost, DisplayEntity } from '../../../lib/assistant/types';

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
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' } }),
}));
vi.mock('../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="live-player-stub" />,
}));

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
