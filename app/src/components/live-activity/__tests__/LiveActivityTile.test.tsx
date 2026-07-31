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
import { render, screen, fireEvent } from '@testing-library/react';
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
  // Echoes the interpolation so an assertion can tell a label that names its
  // monitor from one that does not.
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${Object.values(params).join(',')}` : key,
  }),
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
const onDismiss = vi.fn();

/** A representative span: a 16:9 tile in a 400px column, header included. */
const ROW_SPAN = 257;

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
      rowSpan={ROW_SPAN}
      onDismiss={onDismiss}
    />
  );
}

describe('LiveActivityTile', () => {
  beforeEach(() => {
    propCalls.length = 0;
    onDismiss.mockClear();
  });

  it('hands the page the monitor to clear, naming it for a screen reader', () => {
    renderTile(EPISODE_START);

    const button = screen.getByTestId('live-activity-dismiss-3');
    expect(button).toHaveAttribute('aria-label', 'live_activity.dismiss|Front Door');
    fireEvent.click(button);

    expect(onDismiss).toHaveBeenCalledWith('3');
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
        rowSpan={ROW_SPAN}
        onDismiss={onDismiss}
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

  it('claims its own height in grid rows so it never shares a row', () => {
    renderTile(EPISODE_START);
    expect(screen.getByTestId('live-activity-tile')).toHaveStyle({
      gridRowEnd: `span ${ROW_SPAN}`,
    });
  });

  it('leaves placement to the grid until the grid has been measured', () => {
    // A span of one pixel row would squash the tile, so an unmeasured grid
    // gets no span at all rather than a guessed one.
    render(
      <LiveActivityTile
        entry={ENTRY}
        monitor={MONITOR}
        status={undefined}
        currentProfile={PROFILE}
        accessToken="t"
        navigate={navigate}
        now={EPISODE_START}
        rowSpan={undefined}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByTestId('live-activity-tile').style.gridRowEnd).toBe('');
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

  // The grid gives every tile the same width, so the ratio handed down here is
  // the only thing that makes one tile taller than another. A ratio of w/h
  // renders at height = width / (w/h), so a smaller ratio value is a taller
  // tile; the assertions compare that number rather than the string.
  const renderedRatio = (monitor: Partial<Monitor>): number => {
    propCalls.length = 0;
    render(
      <LiveActivityTile
        entry={ENTRY}
        monitor={{ ...MONITOR, ...monitor } as Monitor}
        status={undefined}
        currentProfile={PROFILE}
        accessToken="t"
        navigate={navigate}
        now={EPISODE_START}
        rowSpan={ROW_SPAN}
        onDismiss={onDismiss}
      />
    );
    const [w, h] = String(propCalls[0].mediaAspectRatio).split('/').map(Number);
    return w / h;
  };

  it('gives a 4:3 camera a taller tile than a 16:9 one', () => {
    const fourThree = renderedRatio({ Width: '640', Height: '480' });
    const sixteenNine = renderedRatio({ Width: '1920', Height: '1080' });

    expect(fourThree).toBeCloseTo(4 / 3);
    expect(sixteenNine).toBeCloseTo(16 / 9);
    expect(fourThree).toBeLessThan(sixteenNine);
  });

  it('turns a rotated camera on its side, tile and all', () => {
    const upright = renderedRatio({ Width: '1920', Height: '1080' });
    const rotated = renderedRatio({
      Width: '1920',
      Height: '1080',
      Orientation: 'ROTATE_90',
    });

    expect(rotated).toBeCloseTo(1080 / 1920);
    expect(rotated).toBeLessThan(upright);
  });

  it('falls back to a shaped tile when the camera reports no usable size', () => {
    // Zero-height would be a zero-height tile: an invisible camera on the one
    // page whose job is showing what is alarming right now.
    expect(renderedRatio({ Width: '0', Height: '0' })).toBeCloseTo(16 / 9);
    expect(renderedRatio({ Width: undefined, Height: undefined })).toBeCloseTo(16 / 9);
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
        rowSpan={ROW_SPAN}
        onDismiss={onDismiss}
      />
    );

    expect(Object.is(propCalls[0].titleIcon, propCalls[1].titleIcon)).toBe(false);
  });
});
