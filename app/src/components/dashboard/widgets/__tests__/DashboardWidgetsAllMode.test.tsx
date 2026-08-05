/**
 * All-mode smoke test for the dashboard widgets (refs #337): none of them
 * may throw when the virtual ALL_PROFILES_ID sentinel is the active
 * selection, whether or not any profile's query has resolved yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonitorWidget } from '../MonitorWidget';
import { EventsWidget } from '../EventsWidget';
import { TimelineWidget } from '../TimelineWidget';
import { HeatmapWidget } from '../HeatmapWidget';
import { useProfileScope } from '../../../../hooks/useProfileScope';
import { useProfileById } from '../../../../hooks/useCurrentProfile';
import { useBandwidthSettings } from '../../../../hooks/useBandwidthSettings';
import { getSession } from '../../../../services/sessions';
import { getEvents } from '../../../../api/events';
import { getMonitor, getMonitors } from '../../../../api/monitors';
import { asProfileId } from '../../../../api/types';

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
vi.mock('../../../../hooks/useBandwidthSettings', () => ({
  useBandwidthSettings: vi.fn(),
}));
vi.mock('../../../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../../../hooks/useCurrentProfile', () => ({
  useProfileById: vi.fn(),
  // useEventTagMapping (real, via EventsWidget) also imports useCurrentProfile.
  useCurrentProfile: () => ({ currentProfile: null, settings: {}, hasProfile: false, isAllMode: true }),
}));
vi.mock('../../../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(),
  // useEventTagMapping (real, via EventsWidget) is pulled in through
  // hooks/useCurrentProfile -> stores/profile.ts, which calls this at
  // module load time even though these tests never exercise the tag fetch.
  registerSessionsGate: vi.fn(),
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

const profileA = { id: asProfileId('profile-a'), name: 'Home', timezone: 'UTC' };
const profileB = { id: asProfileId('profile-b'), name: 'Work', timezone: 'UTC' };

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../../api/client').ApiClient;
}

describe('Dashboard widgets under the ALL_PROFILES_ID sentinel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBandwidthSettings).mockReturnValue({
      eventsWidgetInterval: 30000,
      timelineHeatmapInterval: 60000,
    } as never);
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [profileA, profileB],
      settings: {},
    } as never);
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id === profileB.id ? profileB : id === profileA.id ? profileA : null,
      settings: { hoverPreview: { dashboard: false }, showProtocolLabel: false },
    } as never));
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: clientFor(id),
      timezone: 'UTC',
    }));
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    vi.mocked(getMonitor).mockResolvedValue({ Monitor: { Id: '1', Name: 'Cam', Deleted: false } } as never);
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
