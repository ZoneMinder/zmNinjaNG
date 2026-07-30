import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import LiveActivity from '../LiveActivity';
import { getMonitors, getAlarmStatus } from '../../api/monitors';

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
  getAlarmStatus: vi.fn(),
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', portalUrl: 'https://zm.test' },
    settings: {
      liveActivityPollSeconds: 5,
      liveActivityDwellSeconds: 30,
      liveActivityMaxTiles: 12,
      liveActivityIgnoredMonitorIds: [],
      bandwidthMode: 'normal',
      monitorGridCols: 2,
    },
  }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean; accessToken: string | null }) => unknown) =>
    selector({ isAuthenticated: true, accessToken: 't' }),
}));

// The real stores/notifications.ts module is heavy: importing it for real
// pulls in stores/profile.ts, which subscribes to the auth store at module
// load and throws against the bare mock above. resolvePollIntervalMs's exact
// floor behavior is covered by stores/__tests__/notifications.test.ts; this
// page only needs a poll interval to exist.
vi.mock('../../stores/notifications', () => ({
  resolvePollIntervalMs: () => 1000,
}));

// No i18next instance is initialized in this test file, and the live_activity.*
// locale keys don't exist until Task 7 lands, so the real hook would just echo
// the raw key back with no interpolation (every tile would render identical
// text). Mocking `t` with a deterministic, param-aware stub -- the same
// convention MontageMonitor.test.tsx already uses -- keeps these assertions
// able to fail on the actual name/id/state values instead of asserting on a
// constant string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}_${JSON.stringify(params)}` : key,
  }),
}));

// The tile mounts a real video stream otherwise.
vi.mock('../../components/monitors/MontageMonitor', () => ({
  MontageMonitor: ({ titleOverride }: { titleOverride?: string }) => (
    <div data-testid="live-activity-tile-mock">{titleOverride}</div>
  ),
}));

const mockMonitors = vi.mocked(getMonitors);
const mockStatus = vi.mocked(getAlarmStatus);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const MONITORS = {
  monitors: [
    { Monitor: { Id: '3', Name: 'Front Door', Function: 'Modect', Capturing: 'Always' } },
    { Monitor: { Id: '4', Name: 'Backyard', Function: 'Modect', Capturing: 'Always' } },
  ],
};

describe('LiveActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMonitors.mockResolvedValue(MONITORS as never);
  });

  it('shows only the alarming monitor, labelled with name, id, and state', async () => {
    mockStatus.mockImplementation(async (id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    // TODO(Task 7): once live_activity.* locale keys land, tighten this to the
    // real translated string instead of the deterministic test-mock format.
    const expectedTitle = `live_activity.tile_title_${JSON.stringify({
      name: 'Front Door',
      id: '3',
      state: 'live_activity.state_alarm',
    })}`;

    await waitFor(() => {
      expect(screen.getByText(expectedTitle)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument();
  });

  it('shows the quiet empty state when nothing is alarming', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    // TODO(Task 7): tighten to the real "All quiet" copy once locale keys land.
    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('live_activity.all_quiet');
    });
  });

  it('never polls a monitor on the ignore list', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    // Both monitors are pollable in this fixture; the ignore-list case itself
    // is covered by the next test, which overrides the mocked settings.
    expect(mockStatus.mock.calls.map((c) => c[0]).sort()).toEqual(['3', '4']);
  });

  it('drops an ignored monitor id from polling', async () => {
    // The module-level vi.mock factories above are hoisted and shared across
    // this file's tests, so overriding just the settings mock for one test
    // needs a fresh module graph: reset it, doMock the override, then
    // re-import both the page and the mocked API functions it will resolve to.
    vi.resetModules();
    vi.doMock('../../hooks/useCurrentProfile', () => ({
      useCurrentProfile: () => ({
        currentProfile: { id: 'p1', portalUrl: 'https://zm.test' },
        settings: {
          liveActivityPollSeconds: 5,
          liveActivityDwellSeconds: 30,
          liveActivityMaxTiles: 12,
          liveActivityIgnoredMonitorIds: ['4'],
          bandwidthMode: 'normal',
          monitorGridCols: 2,
        },
      }),
    }));

    const { default: LiveActivityWithIgnore } = await import('../LiveActivity');
    const { getMonitors: reimportedGetMonitors, getAlarmStatus: reimportedGetAlarmStatus } =
      await import('../../api/monitors');
    vi.mocked(reimportedGetMonitors).mockResolvedValue(MONITORS as never);
    vi.mocked(reimportedGetAlarmStatus).mockResolvedValue({ status: 0 } as never);

    render(<LiveActivityWithIgnore />, { wrapper });

    await waitFor(() => {
      expect(reimportedGetAlarmStatus).toHaveBeenCalled();
    });
    expect(vi.mocked(reimportedGetAlarmStatus).mock.calls.map((c) => c[0])).toEqual(['3']);
  });
});
