import { describe, it, expect } from 'vitest';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  type ActiveMonitorEntry,
} from '../live-activity';

const DWELL = 30_000;

describe('reduceActiveMonitors', () => {
  it('adds a monitor when it starts alarming', () => {
    const next = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    expect(next.map((e) => e.monitorId)).toEqual(['1']);
    expect(next[0].enteredAt).toBe(1000);
    expect(next[0].isCooling).toBe(false);
  });

  it('ignores monitors that are idle', () => {
    const next = reduceActiveMonitors([], { '1': 'idle', '2': 'unknown' }, 1000, DWELL);
    expect(next).toEqual([]);
  });

  it('keeps a monitor listed while its alarm has cleared but dwell has not elapsed', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'idle' }, 1000 + DWELL - 1, DWELL);
    expect(next.map((e) => e.monitorId)).toEqual(['1']);
    expect(next[0].isCooling).toBe(true);
  });

  it('drops a monitor once dwell has fully elapsed', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'idle' }, 1000 + DWELL + 1, DWELL);
    expect(next).toEqual([]);
  });

  it('resets the dwell timer when a monitor re-alarms inside the window', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const cooling = reduceActiveMonitors(first, { '1': 'idle' }, 20_000, DWELL);
    const reArmed = reduceActiveMonitors(cooling, { '1': 'alarm' }, 25_000, DWELL);
    // Would have expired at 31_000 without the reset; now survives well past it.
    const later = reduceActiveMonitors(reArmed, { '1': 'idle' }, 50_000, DWELL);
    expect(later.map((e) => e.monitorId)).toEqual(['1']);
  });

  it('counts each fresh alarm rather than re-entering the monitor', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const cooling = reduceActiveMonitors(first, { '1': 'idle' }, 5000, DWELL);
    const reArmed = reduceActiveMonitors(cooling, { '1': 'alarm' }, 9000, DWELL);
    expect(reArmed[0].alarmCount).toBe(2);
    expect(reArmed[0].enteredAt).toBe(1000);
  });

  it('does not count a sustained alarm as a second alarm', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const still = reduceActiveMonitors(first, { '1': 'alarm' }, 3000, DWELL);
    expect(still[0].alarmCount).toBe(1);
  });

  it('appends new monitors after existing ones rather than re-sorting', () => {
    const first = reduceActiveMonitors([], { '2': 'alarm' }, 1000, DWELL);
    const second = reduceActiveMonitors(first, { '2': 'alarm', '1': 'alarm' }, 2000, DWELL);
    expect(second.map((e) => e.monitorId)).toEqual(['2', '1']);
  });

  it('keeps surviving monitors in place when one in the middle expires', () => {
    let list: ActiveMonitorEntry[] = [];
    list = reduceActiveMonitors(list, { a: 'alarm' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, 2000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm', c: 'alarm' }, 3000, DWELL);
    // b goes idle and expires; a and c stay alarming.
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'idle', c: 'alarm' }, 3000 + DWELL + 1, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['a', 'c']);
  });

  it('drops a monitor that disappears from the states map entirely', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, {}, 1000 + DWELL + 1, DWELL);
    expect(next).toEqual([]);
  });

  it('records the latest state so the tile can label itself', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'alert' }, 2000, DWELL);
    expect(next[0].state).toBe('alert');
  });

  it('expires immediately when dwell is zero', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'idle' }, 1001, 0);
    expect(next).toEqual([]);
  });

  it('returns the same array reference when nothing changed', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const again = reduceActiveMonitors(first, { '1': 'alarm' }, 1000, DWELL);
    expect(again).toBe(first);
  });
});

describe('capActiveMonitors', () => {
  const make = (id: string): ActiveMonitorEntry => ({
    monitorId: id,
    state: 'alarm',
    enteredAt: 0,
    lastAlarmingAt: 0,
    alarmCount: 1,
    isCooling: false,
  });

  it('returns every entry when under the cap', () => {
    const { visible, overflowCount } = capActiveMonitors([make('1'), make('2')], 12);
    expect(visible.map((e) => e.monitorId)).toEqual(['1', '2']);
    expect(overflowCount).toBe(0);
  });

  it('truncates and reports how many were hidden', () => {
    const entries = ['1', '2', '3', '4', '5'].map(make);
    const { visible, overflowCount } = capActiveMonitors(entries, 3);
    expect(visible.map((e) => e.monitorId)).toEqual(['1', '2', '3']);
    expect(overflowCount).toBe(2);
  });
});
