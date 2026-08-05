/**
 * MonitorCard is memo()'d, so a parent re-render (the monitor status poll
 * refetches on an interval) must not re-render every card. memo does a shallow
 * compare of props, so one prop with a fresh identity per render defeats it.
 * These tests pin the two things that keep the compare honest: the callback
 * prop's identity, and the resulting render count.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import Monitors from '../Monitors';

const mockState = vi.hoisted(() => ({
  renderCount: new Map<string, number>(),
  settingsProps: [] as Array<(monitor: unknown) => void>,
  newEventCounts: { '1': 2, '2': 1 } as Record<string, number>,
  newestEventAt: { '1': '2026-07-10 09:00:00', '2': '2026-07-10 08:00:00' } as Record<string, string | null>,
  // Same array reference returned on every call, mirroring the real
  // useScopedMonitors' `combine`-based reference stability (Task 4). A fresh
  // array per call would defeat the memo comparison this file exists to test.
  scopedMonitors: [
    { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
    { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '2', Name: 'Back Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
  ],
}));

vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => ({
    monitors: mockState.scopedMonitors,
    errors: [],
    isLoading: false,
    refetchProfile: vi.fn(),
  }),
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-1', name: 'Home' },
    settings: {
      monitorsViewMode: 'list',
      monitorsFeedFit: 'contain',
      monitorGridCols: 2,
      monitorsGroupByServer: false,
    },
    isAllMode: false,
  }),
}));

vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: () => ({ profiles: [{ id: 'profile-1' }] }),
}));

vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ isFilterActive: false, filteredMonitorIds: [], isFilterReady: true }),
}));

vi.mock('../../components/filters/GroupFilterSelect', () => ({
  GroupFilterSelect: () => <div data-testid="group-filter-select-stub" />,
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (state: { updateProfileSettings: (...args: unknown[]) => void }) => unknown) =>
    selector({ updateProfileSettings: vi.fn() }),
}));

vi.mock('../../hooks/useMonitorNewEvents', () => ({
  useMonitorNewEvents: () => ({ counts: mockState.newEventCounts, newest: mockState.newestEventAt }),
  useScopedMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  scopedMonitorEventKey: (profileId: string, monitorId: string) => `${profileId}:${monitorId}`,
}));

// Stand-in for the real memo()'d MonitorCard (MonitorCard.tsx:382). It is
// memo()'d here for the same reason, and counts how often its body actually
// runs so an escaped re-render is visible.
vi.mock('../../components/monitors/MonitorCard', async () => {
  const { memo } = await import('react');
  const Card = ({
    monitor,
    onShowSettings,
  }: {
    monitor: { Id: string; Name: string };
    onShowSettings: (monitor: unknown) => void;
  }) => {
    mockState.renderCount.set(monitor.Id, (mockState.renderCount.get(monitor.Id) ?? 0) + 1);
    mockState.settingsProps.push(onShowSettings);
    return <div data-testid={`monitor-card-${monitor.Id}`}>{monitor.Name}</div>;
  };
  return { MonitorCard: memo(Card) };
});

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string }) => unknown) =>
    selector({ currentProfileId: 'profile-1' }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthSlice: () => ({ version: '1.38.0' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Its own tests cover the toggle (including how it resolves the page's
// Streaming Mode in All mode); stubbing keeps that resolution's stores out of
// this file's mock surface.
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({
  AnalysisFramesToggle: () => <div data-testid="analysis-frames-toggle-stub" />,
}));

describe('Monitors page memo stability', () => {
  beforeEach(() => {
    mockState.renderCount.clear();
    mockState.settingsProps.length = 0;
  });

  it('passes a reference-stable onShowSettings to every card across re-renders', () => {
    const { rerender } = render(<Monitors />);
    const firstPass = [...mockState.settingsProps];
    expect(firstPass).toHaveLength(2);

    rerender(<Monitors />);

    // Every card, on both passes, got the exact same function object.
    for (const handler of mockState.settingsProps) {
      expect(handler).toBe(firstPass[0]);
    }
  });

  it('does not re-render memoized cards when the parent re-renders with unchanged data', () => {
    const { rerender } = render(<Monitors />);
    expect(mockState.renderCount.get('1')).toBe(1);
    expect(mockState.renderCount.get('2')).toBe(1);

    // Stands in for the 20s monitor status poll settling with identical data.
    rerender(<Monitors />);
    rerender(<Monitors />);

    expect(mockState.renderCount.get('1')).toBe(1);
    expect(mockState.renderCount.get('2')).toBe(1);
  });
});
