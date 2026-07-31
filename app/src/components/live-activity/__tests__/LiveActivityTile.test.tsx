/**
 * The elapsed label ticks; the video tile underneath it must not.
 *
 * MontageMonitor is memo'd precisely so a live tile is not re-rendered by
 * whatever its page is doing. A label that changes every second, handed to it
 * as a prop, would defeat that for every tile on screen at once, so the label
 * is a sibling overlay and every prop MontageMonitor does receive has to stay
 * reference-identical across a tick (refs #313).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveActivityTile } from '../LiveActivityTile';
import type { ActiveMonitorEntry } from '../../../lib/monitor/live-activity';
import type { Monitor, Profile } from '../../../api/types';

const propCalls = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('../../monitors/MontageMonitor', () => ({
  MontageMonitor: (props: Record<string, unknown>) => {
    propCalls.push(props);
    return <div data-testid="montage-monitor-mock" />;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const EPISODE_START = 1_700_000_000_000;

const ENTRY: ActiveMonitorEntry = {
  monitorId: '3',
  state: 'alarm',
  enteredAt: EPISODE_START,
  lastAlarmingAt: EPISODE_START,
  episodeStartedAt: EPISODE_START,
  isCooling: false,
};

const MONITOR = { Id: '3', Name: 'Front Door' } as Monitor;
const PROFILE = { id: 'p1' } as Profile;
const navigate = vi.fn();

function renderTile(now: number, entry: ActiveMonitorEntry = ENTRY) {
  return render(
    <LiveActivityTile
      entry={entry}
      monitor={MONITOR}
      status={undefined}
      currentProfile={PROFILE}
      accessToken="t"
      navigate={navigate}
      now={now}
    />
  );
}

describe('LiveActivityTile', () => {
  beforeEach(() => {
    propCalls.length = 0;
  });

  it('reads how long the alarm episode has been running', () => {
    renderTile(EPISODE_START + 247_000);

    expect(screen.getByTestId('live-activity-elapsed-3')).toHaveTextContent('4:07');
  });

  it('advances the label without changing a single tile prop', () => {
    const { rerender } = renderTile(EPISODE_START);
    expect(screen.getByTestId('live-activity-elapsed-3')).toHaveTextContent('0:00');

    rerender(
      <LiveActivityTile
        entry={ENTRY}
        monitor={MONITOR}
        status={undefined}
        currentProfile={PROFILE}
        accessToken="t"
        navigate={navigate}
        now={EPISODE_START + 5_000}
      />
    );

    expect(screen.getByTestId('live-activity-elapsed-3')).toHaveTextContent('0:05');
    expect(propCalls).toHaveLength(2);
    const [first, second] = propCalls;
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    for (const key of Object.keys(first)) {
      // Object.is, because React.memo compares props exactly this way: a
      // freshly built element or object here re-renders the video tile even
      // though it is equal by value.
      expect(`${key}:${Object.is(first[key], second[key])}`).toBe(`${key}:true`);
    }
  });

  it('shows what ZoneMinder said triggered the alarm, when it said anything', () => {
    renderTile(EPISODE_START, { ...ENTRY, cause: 'Motion: All' });

    const cause = screen.getByTestId('live-activity-cause-3');
    expect(cause).toHaveTextContent('Motion: All');
    // Truncated on a narrow tile, so the full text has to stay reachable.
    expect(cause).toHaveAttribute('title', 'Motion: All');
  });

  it('reads correctly with no cause reported at all', () => {
    renderTile(EPISODE_START);

    expect(screen.queryByTestId('live-activity-cause-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('live-activity-elapsed-3')).toBeInTheDocument();
  });

  it('rebuilds the state icon when the state actually changes', () => {
    const { rerender } = renderTile(EPISODE_START);

    rerender(
      <LiveActivityTile
        entry={{ ...ENTRY, state: 'idle', isCooling: true }}
        monitor={MONITOR}
        status={undefined}
        currentProfile={PROFILE}
        accessToken="t"
        navigate={navigate}
        now={EPISODE_START + 1_000}
      />
    );

    expect(Object.is(propCalls[0].titleIcon, propCalls[1].titleIcon)).toBe(false);
  });
});
