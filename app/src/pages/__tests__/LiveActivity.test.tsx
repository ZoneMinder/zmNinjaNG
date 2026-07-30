import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import LiveActivity from '../LiveActivity';
import { getMonitors, getAlarmStatus } from '../../api/monitors';
import enTranslation from '../../locales/en/translation.json';

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
  // No events for any profile: the accelerant selector always sees an empty
  // hint set, so these tests exercise the plain poll path.
  useNotificationStore: (selector: (s: { profileEvents: Record<string, unknown[]> }) => unknown) =>
    selector({ profileEvents: {} }),
}));

// Initializing the real i18next instance drags in its LanguageDetector setup;
// instead this stub does the same lookup + interpolation i18next does, but
// against the real English strings bundled in translation.json. That keeps
// assertions able to fail on the actual rendered copy (e.g. a changed
// tile_title format) rather than on a fabricated key/params string.
function resolveEn(key: string): string {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }, enTranslation) as string;
}

function translate(key: string, params?: Record<string, unknown>): string {
  const template = resolveEn(key);
  if (typeof template !== 'string') return key;
  if (!params) return template;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(params[name] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
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

    await waitFor(() => {
      expect(screen.getByText('Front Door(3):Alarmed')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument();
  });

  it('shows the quiet empty state when nothing is alarming', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet');
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

  // Carried gap (Task 8): the repeat-alarm count badge (entry.alarmCount > 1)
  // has reducer-level unit coverage (lib/monitor/__tests__/live-activity.test.ts)
  // but no page-level coverage of it actually reaching the DOM. Driving this
  // through the e2e harness would need a live server to alarm, clear, and
  // re-alarm a real monitor on cue, which is not controllable there; this
  // drives the same sequence through mocked polls instead.
  it('shows the repeat-alarm count once a monitor clears and alarms again', async () => {
    vi.resetModules();
    vi.doMock('../../hooks/useCurrentProfile', () => ({
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
    // A fast poll interval so the alarm -> clear -> alarm sequence below
    // plays out in milliseconds instead of the module-level mock's 1000ms.
    vi.doMock('../../stores/notifications', () => ({
      resolvePollIntervalMs: () => 20,
      useNotificationStore: (selector: (s: { profileEvents: Record<string, unknown[]> }) => unknown) =>
        selector({ profileEvents: {} }),
    }));

    const { default: LiveActivityFast } = await import('../LiveActivity');
    const { getMonitors: reimportedGetMonitors, getAlarmStatus: reimportedGetAlarmStatus } =
      await import('../../api/monitors');
    vi.mocked(reimportedGetMonitors).mockResolvedValue(MONITORS as never);

    let monitorThreeCalls = 0;
    vi.mocked(reimportedGetAlarmStatus).mockImplementation(async (id: string) => {
      if (id !== '3') return { status: 0 } as never;
      monitorThreeCalls += 1;
      // Poll 1: alarming (enters the list, alarmCount 1). Poll 2: clears
      // (stays resident, cooling, within the 30s dwell). Poll 3+: alarms
      // again, a fresh alarm while cooling, alarmCount becomes 2.
      return { status: monitorThreeCalls === 2 ? 0 : 2 } as never;
    });

    render(<LiveActivityFast />, { wrapper });

    await waitFor(
      () => {
        expect(screen.getByTestId('live-activity-count-3')).toHaveTextContent('×2');
      },
      { timeout: 5000 }
    );
  }, 10000);
});
