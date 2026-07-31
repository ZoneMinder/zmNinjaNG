import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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

// Mutable so a test can set a page preference or the server version before it
// renders. vi.hoisted because the mock factories below are hoisted above
// ordinary module scope.
const env = vi.hoisted(() => ({
  settings: {
    liveActivityPollSeconds: 5,
    liveActivityDwellSeconds: 30,
    liveActivityMaxTiles: 12,
    liveActivityIgnoredMonitorIds: [] as string[],
    liveActivityWatchContinuousIds: [] as string[],
    liveActivityIsFullscreen: false,
    bandwidthMode: 'normal',
    monitorGridCols: 2,
  },
  zmVersion: '1.36.33' as string | null,
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', portalUrl: 'https://zm.test' },
    settings: env.settings,
  }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: (
    selector: (s: {
      isAuthenticated: boolean;
      accessToken: string | null;
      version: string | null;
    }) => unknown
  ) => selector({ isAuthenticated: true, accessToken: 't', version: env.zmVersion }),
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
// assertions able to fail on the actual rendered copy (e.g. a changed state
// label) rather than on a fabricated key/params string.
function resolveEn(key: string): string {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }, enTranslation) as string;
}

function translate(key: string, params?: Record<string, unknown>): string {
  // A key called with a count resolves against its `_one` / `_other` family,
  // the way i18next does, so assertions still read the real English copy.
  const count = params?.count;
  const suffix = typeof count === 'number' ? (count === 1 ? '_one' : '_other') : '';
  const template = resolveEn(`${key}${suffix}`) ?? resolveEn(key);
  if (typeof template !== 'string') return key;
  if (!params) return template;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(params[name] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// Counts how many times a tile has been rendered, so a test can tell a
// settled page from one re-rendering in a loop. vi.hoisted because the mock
// factory below is hoisted above ordinary module scope.
const tileRenders = vi.hoisted(() => ({ count: 0 }));

// The tile mounts a real video stream otherwise. The header is reproduced as
// icon-then-name, the same shape the real component renders, so assertions
// about what the header says still mean something.
vi.mock('../../components/monitors/MontageMonitor', () => ({
  MontageMonitor: ({
    monitor,
    titleOverride,
    titleIcon,
  }: {
    monitor: { Name: string };
    titleOverride?: string;
    titleIcon?: ReactNode;
  }) => {
    tileRenders.count += 1;
    return (
      <div data-testid="live-activity-tile-mock">
        {titleIcon}
        {titleOverride ?? monitor.Name}
      </div>
    );
  },
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
    tileRenders.count = 0;
    env.settings.liveActivityIgnoredMonitorIds = [];
    env.settings.liveActivityWatchContinuousIds = [];
    env.settings.liveActivityIsFullscreen = false;
    env.zmVersion = '1.36.33';
    mockMonitors.mockResolvedValue(MONITORS as never);
  });

  it('shows only the alarming monitor, named without its id', async () => {
    mockStatus.mockImplementation(async (id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument();
    // The header used to read "Front Door(3):Alarmed"; the id is gone and the
    // state word is now the icon's accessible name instead of body text.
    expect(screen.getByTestId('live-activity-tile-mock')).toHaveTextContent(/^Front Door$/);
  });

  it('announces the alarm state through the header icon', async () => {
    mockStatus.mockImplementation(async (id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Alarmed' })).toBeInTheDocument();
    });
    expect(screen.getByRole('img', { name: 'Alarmed' })).toHaveAttribute('title', 'Alarmed');
  });

  // A monitor that always records is always inside an event, so it would sit
  // on this page forever and crowd out whatever is genuinely alarming.
  describe('continuous-recording monitors', () => {
    const WITH_CONTINUOUS = {
      monitors: [
        ...MONITORS.monitors,
        { Monitor: { Id: '5', Name: 'Driveway', Function: 'Mocord', Capturing: 'Always' } },
      ],
    };

    beforeEach(() => {
      mockMonitors.mockResolvedValue(WITH_CONTINUOUS as never);
      // Everything alarming, so only the watched set decides what renders.
      mockStatus.mockResolvedValue({ status: 2 } as never);
    });

    it('leaves a continuous recorder off the page by default', async () => {
      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Front Door')).toBeInTheDocument();
      });
      expect(screen.queryByText('Driveway')).not.toBeInTheDocument();
    });

    it('watches a continuous recorder the user opted back in', async () => {
      env.settings.liveActivityWatchContinuousIds = ['5'];

      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Driveway')).toBeInTheDocument();
      });
    });

    it('keeps an opted-in continuous recorder out when it is also ignored', async () => {
      env.settings.liveActivityWatchContinuousIds = ['5'];
      env.settings.liveActivityIgnoredMonitorIds = ['5'];

      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Front Door')).toBeInTheDocument();
      });
      expect(screen.queryByText('Driveway')).not.toBeInTheDocument();
    });

    it('reads Recording rather than Function on ZM 1.38+', async () => {
      // The same monitor: pre-1.38 Function says continuous, 1.38 Recording
      // says on-motion. The 1.38 field wins, so it is watched.
      env.zmVersion = '1.38.0';
      mockMonitors.mockResolvedValue({
        monitors: [
          ...MONITORS.monitors,
          {
            Monitor: {
              Id: '5',
              Name: 'Driveway',
              Function: 'Mocord',
              Recording: 'OnMotion',
              Capturing: 'Always',
            },
          },
        ],
      } as never);

      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Driveway')).toBeInTheDocument();
      });
    });
  });

  it('shows the quiet empty state when nothing is alarming', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet');
    });
    expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('Watching 2 monitors');
  });

  it('uses the singular form when watching a single monitor', async () => {
    // Regression: watching_count passed i18next a count with no plural family
    // behind it, so one monitor read "Watching 1 monitors".
    mockMonitors.mockResolvedValue({ monitors: [MONITORS.monitors[0]] } as never);
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('Watching 1 monitor');
    });
    expect(screen.getByTestId('live-activity-empty')).not.toHaveTextContent('1 monitors');
  });

  it('stops re-rendering once an alarming monitor has settled', async () => {
    // Regression: useAlarmStates handed back a fresh `states` object on every
    // render, the dwell effect listed it as a dependency, and the reducer
    // stamps Date.now() into every alarming entry. So each render produced a
    // new list, which set state, which rendered again, forever; the wall clock
    // advancing between iterations meant it never converged. The observable
    // symptom is render count, so that is what this measures.
    //
    // The window is real time rather than a render count taken immediately:
    // a single jsdom render is sub-millisecond, so Date.now() often does not
    // advance between two adjacent iterations and the loop stalls for a tick
    // before resuming. Over 300ms the clock advances ~300 times, so the loop
    // is guaranteed to show itself rather than depending on that timing luck.
    // The mocked poll interval is 1000ms and the cooling timer fires at 1000ms,
    // so a settled page has no legitimate reason to render at all in the
    // window.
    mockStatus.mockImplementation(async (id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });

    const settled = tileRenders.count;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // Measured at 471 renders in this window before the fix, 0 after. Ten
    // leaves room for an unlucky poll or timer landing inside the window
    // without letting a loop through.
    expect(tileRenders.count - settled).toBeLessThan(10);
    // The tile is still on screen, so the bound above is not passing because
    // the page went blank.
    expect(screen.getByText('Front Door')).toBeInTheDocument();
  });

  it('keeps the page chrome out of the way in fullscreen', async () => {
    // A wall display should show tiles, not the heading, the grid controls and
    // the gear. The tiles themselves still render, so the assertion below is
    // about the chrome rather than about the page having gone blank.
    env.settings.liveActivityIsFullscreen = true;
    mockStatus.mockImplementation(async (id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
    expect(screen.getByTestId('live-activity-fullscreen')).toBeInTheDocument();
    expect(screen.queryByTestId('live-activity-settings-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-activity-fullscreen-btn')).not.toBeInTheDocument();
    // The only control left is the way back out.
    expect(screen.getByTestId('live-activity-exit-fullscreen-btn')).toHaveAttribute(
      'aria-label',
      'Exit Fullscreen'
    );
  });

  it('offers a fullscreen control while the page chrome is showing', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    const button = await screen.findByTestId('live-activity-fullscreen-btn');
    expect(button).toHaveAttribute('aria-label', 'Fullscreen');
    expect(screen.queryByTestId('live-activity-fullscreen')).not.toBeInTheDocument();
  });

  it('shows the error instead of claiming all quiet when the server is unreachable', async () => {
    // A false "nothing is alarming" during an outage is the worst reading
    // this page can give, so the quiet state is gated on having heard back.
    mockMonitors.mockRejectedValue(new Error('Network Error'));
    mockStatus.mockRejectedValue(new Error('Network Error'));

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Network Error/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('live-activity-empty')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton before the first alarm poll answers', async () => {
    // A cold open used to paint the quiet empty state, so the page asserted
    // "all quiet" before it had asked anything.
    mockStatus.mockImplementation(() => new Promise(() => {}) as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-loading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('live-activity-empty')).not.toBeInTheDocument();
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

  it('keeps the short enter duration on the tile', async () => {
    // Regression: the tile carried `duration-200` for the enter animation and
    // `duration-700` for a cooling transition. cn() is twMerge(clsx(...)),
    // tailwindcss-animate maps `duration-*` onto animationDuration as well as
    // core Tailwind's transitionDuration, so twMerge saw one conflict group
    // and dropped `duration-200` outright. Tiles entered over 700ms. The
    // cooling transition is gone now, but the enter duration stays an
    // arbitrary-value class so that re-adding any transition duration here
    // cannot silently swallow it again. The collision is invisible by reading
    // the source, so the resolved class list is what gets asserted.
    mockStatus.mockImplementation(async (id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    const tile = await screen.findByTestId('live-activity-tile');
    expect(tile.className).toMatch(/\[animation-duration:200ms\]/);
  });

  it('renders a cooling tile exactly like an alarming one', async () => {
    // Two reasons, and the rendering one is the load-bearing one. The tile
    // carries `view-transition-name`, so it is the element the browser
    // snapshots, and a captured image is generated with the element's own
    // opacity and filter already applied while ::view-transition-new is the
    // live element. The pair is composited with mix-blend-mode: plus-lighter,
    // which only cross-fades correctly when both halves are the same image, so
    // an element animating its own opacity or filter composites wrong for the
    // whole transition. The grid reorders roughly once a second while
    // ZoneMinder flaps a winding-down monitor between `alert` (alarming) and
    // `tape` (not alarming), so that repeated for the length of an event's
    // tail: exactly the window before a tile dwells out. Winding down is
    // signalled by the state icon dropping out of the header instead. refs #313
    vi.resetModules();
    vi.doMock('../../hooks/useCurrentProfile', () => ({
      useCurrentProfile: () => ({
        currentProfile: { id: 'p1', portalUrl: 'https://zm.test' },
        settings: {
          liveActivityPollSeconds: 5,
          liveActivityDwellSeconds: 30,
          liveActivityMaxTiles: 12,
          liveActivityIgnoredMonitorIds: [],
          liveActivityWatchContinuousIds: [],
          bandwidthMode: 'normal',
          monitorGridCols: 2,
        },
      }),
    }));
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
      // Alarms once to enter the list, then stays quiet inside the 30s dwell,
      // so every later poll leaves it resident and cooling.
      return { status: monitorThreeCalls === 1 ? 2 : 0 } as never;
    });

    render(<LiveActivityFast />, { wrapper });

    // The tile is keyed by monitor id, so this is the same DOM node throughout;
    // capture how it looks while the monitor is still alarming.
    const tile = await screen.findByTestId('live-activity-tile');
    const whileAlarming = tile.className;
    expect(tile.style.viewTransitionName).toBe('live-activity-tile-3');

    // Let several idle polls land, which puts the entry into its cooling state.
    await waitFor(() => expect(monitorThreeCalls).toBeGreaterThanOrEqual(4), { timeout: 5000 });

    expect(tile.className).toBe(whileAlarming);
    expect(tile.className).not.toMatch(/opacity-\d|saturate-|transition-/);
    expect(tile.style.viewTransitionName).toBe('live-activity-tile-3');
  }, 10000);

  it('drops a tile once its dwell window closes', async () => {
    // The list update now runs through a shared callback that may route the
    // state change through a view transition (absent in jsdom, so it falls
    // back to a plain update). A tile that stopped alarming still has to
    // leave, which is what proves the fallback path publishes anything at all.
    vi.resetModules();
    vi.doMock('../../hooks/useCurrentProfile', () => ({
      useCurrentProfile: () => ({
        currentProfile: { id: 'p1', portalUrl: 'https://zm.test' },
        settings: {
          liveActivityPollSeconds: 5,
          // 10ms of dwell, so the window closes between two fast polls.
          liveActivityDwellSeconds: 0.01,
          liveActivityMaxTiles: 12,
          liveActivityIgnoredMonitorIds: [],
          bandwidthMode: 'normal',
          monitorGridCols: 2,
        },
      }),
    }));
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
      // Alarming on the first poll only, quiet from then on.
      return { status: monitorThreeCalls === 1 ? 2 : 0 } as never;
    });

    render(<LiveActivityFast />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(screen.queryByTestId('live-activity-tile')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByTestId('live-activity-empty')).toBeInTheDocument();
  }, 10000);

});
