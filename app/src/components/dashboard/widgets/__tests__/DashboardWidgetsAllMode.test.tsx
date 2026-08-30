/**
 * All-mode smoke test for the dashboard widgets (refs #337): none of them
 * may throw when the virtual ALL_PROFILES_ID sentinel is the active
 * selection, whether or not any profile's query has resolved yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

import { MonitorWidget } from '../MonitorWidget';
import { EventsWidget } from '../EventsWidget';
import { TimelineWidget } from '../TimelineWidget';
import { HeatmapWidget } from '../HeatmapWidget';
import { getEvents } from '../../../../api/events';
import { getMonitor, getMonitors } from '../../../../api/monitors';
import { ALL_PROFILES_ID } from '../../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: () => 'x', fmtDate: () => 'x', fmtWeekday: () => 'x', fmtTimeShort: () => 'x' }),
}));
vi.mock('../../../theme-provider', () => ({
  useTheme: () => ({ theme: 'light' }),
}));
// TimelineWidget renders a real recharts BarChart; jsdom has no layout
// engine, so ResponsiveContainer measures a 0x0 container and recharts logs
// a noisy width/height warning on every render. This is a smoke test for
// throws, not chart output, so stub the whole module out.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));
vi.mock('../../../../api/events', () => ({
  getEvents: vi.fn(),
}));
vi.mock('../../../../api/monitors', () => ({
  getMonitor: vi.fn(),
  getMonitors: vi.fn(),
}));
vi.mock('../../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="live-player" />,
}));
vi.mock('../../../monitors/MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

describe('Dashboard widgets under the ALL_PROFILES_ID sentinel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // bandwidthMode defaults to 'normal' in every seeded profile below, whose
    // real getBandwidthSettings() gives eventsWidgetInterval 30000 and
    // timelineHeatmapInterval 60000 - the same values the old mock hardcoded.
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: {
        [profileA.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
        [profileB.id]: { hoverPreview: { dashboard: false } as never, showProtocolLabel: false },
      },
    });
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    vi.mocked(getMonitor).mockResolvedValue({ Monitor: { Id: '1', Name: 'Cam', Deleted: false } } as never);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  const wrap = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('MonitorWidget does not throw, pinned to the first profile in scope', () => {
    expect(() => render(wrap(<MonitorWidget monitorIds={['1']} profileId={profileA.id} />))).not.toThrow();
  });

  it('EventsWidget does not throw and aggregates across scope.profiles', () => {
    expect(() => render(wrap(<EventsWidget />))).not.toThrow();
  });

  it('TimelineWidget does not throw', () => {
    expect(() => render(wrap(<TimelineWidget />))).not.toThrow();
  });

  it('HeatmapWidget does not throw', () => {
    expect(() => render(wrap(<HeatmapWidget />))).not.toThrow();
  });
});
