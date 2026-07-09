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
}));

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: (string | undefined)[] }) => useQueryMock(options),
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
  useProfileStore: (selector: (state: { currentProfile: () => { id: string; username?: string } | null }) => unknown) =>
    selector({
      currentProfile: () => ({ id: 'profile-1', username: 'admin' }),
    }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Frozen identities. React Query's structural sharing returns the same object
// references when a refetch produces unchanged data, so the real page sees these
// props as reference-equal across a poll too. Recreating them here would hide
// the callback regression behind a `monitor` prop that also changed.
const MONITORS = {
  monitors: [
    { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } },
    { Monitor: { Id: '2', Name: 'Back Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } },
  ],
};
const EVENT_COUNTS = { '1': 2, '2': 1 };

describe('Monitors page memo stability', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    mockState.renderCount.clear();
    mockState.settingsProps.length = 0;

    useQueryMock.mockImplementation(({ queryKey }) => {
      const refetch = vi.fn();
      if (queryKey[0] === 'monitors') {
        return { data: MONITORS, isLoading: false, error: null, refetch };
      }
      if (queryKey[0] === 'consoleEvents') {
        return { data: EVENT_COUNTS, isLoading: false, error: null, refetch };
      }
      return { data: {}, isLoading: false, error: null, refetch };
    });
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
