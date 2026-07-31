import { describe, it, expect } from 'vitest';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  applyLiveAlarmHints,
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

  it('puts the most recently alarmed monitor first', () => {
    // a alarms first, then stops; b alarms later. b is the fresher alarm, so
    // it takes the top slot and a sinks below it while it cools.
    const first = reduceActiveMonitors([], { a: 'alarm', b: 'idle' }, 1000, DWELL);
    const second = reduceActiveMonitors(first, { a: 'idle', b: 'alarm' }, 2000, DWELL);
    expect(second.map((e) => e.monitorId)).toEqual(['b', 'a']);
    expect(second[0].lastAlarmingAt).toBe(2000);
    expect(second[1].lastAlarmingAt).toBe(1000);
  });

  it('breaks a same-tick tie by monitor id rather than by arrival order', () => {
    // Both alarm in the same poll, so neither is more recent. Without the
    // tiebreak their positions would depend on states-map iteration order and
    // could swap on a later render for no reason.
    const first = reduceActiveMonitors([], { '2': 'alarm' }, 1000, DWELL);
    const second = reduceActiveMonitors(first, { '2': 'alarm', '1': 'alarm' }, 2000, DWELL);
    expect(second.map((e) => e.monitorId)).toEqual(['1', '2']);
    const third = reduceActiveMonitors(second, { '1': 'alarm', '2': 'alarm' }, 3000, DWELL);
    expect(third.map((e) => e.monitorId)).toEqual(['1', '2']);
  });

  it('re-sorts a cooling monitor back to the top when it alarms again', () => {
    let list = reduceActiveMonitors([], { a: 'alarm', b: 'idle' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'idle', b: 'alarm' }, 2000, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['b', 'a']);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'idle' }, 3000, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['a', 'b']);
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

  it('returns the same array reference when the sort leaves the order alone', () => {
    // Sorting must not manufacture a new array: every tile re-renders when
    // this reference changes, and a poll tick that changed nothing must not
    // cost that.
    const first = reduceActiveMonitors([], { a: 'alarm', b: 'alarm', c: 'alarm' }, 1000, DWELL);
    expect(first.map((e) => e.monitorId)).toEqual(['a', 'b', 'c']);
    const again = reduceActiveMonitors(first, { a: 'alarm', b: 'alarm', c: 'alarm' }, 1000, DWELL);
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

  it('keeps the most recently alarmed monitors when it truncates', () => {
    // The cap takes the head of the list, and the reducer sorts newest alarm
    // first, so what survives is the freshest activity rather than whatever
    // arrived first.
    const list = reduceActiveMonitors(
      reduceActiveMonitors([], { old: 'alarm', fresh: 'idle' }, 1000, DWELL),
      { old: 'idle', fresh: 'alarm' },
      2000,
      DWELL
    );
    const { visible, overflowCount } = capActiveMonitors(list, 1);
    expect(visible.map((e) => e.monitorId)).toEqual(['fresh']);
    expect(overflowCount).toBe(1);
  });
});

describe('applyLiveAlarmHints', () => {
  it('promotes a watched idle monitor to alarming when a hint names it', () => {
    const result = applyLiveAlarmHints({ '1': 'idle' }, new Set(['1']));
    expect(result['1']).toBe('alarm');
  });

  it('ignores hints for monitors that are not being watched', () => {
    // An ignored or excluded monitor must not be resurrected by a hint.
    const result = applyLiveAlarmHints({ '1': 'idle' }, new Set(['2']));
    expect(result).toEqual({ '1': 'idle' });
  });

  it('leaves an already-alarming state alone rather than downgrading it', () => {
    const result = applyLiveAlarmHints({ '1': 'alert' }, new Set(['1']));
    expect(result['1']).toBe('alert');
  });

  it('returns the same reference when no hint changes anything', () => {
    const states = { '1': 'alarm' as const };
    expect(applyLiveAlarmHints(states, new Set(['1']))).toBe(states);
    expect(applyLiveAlarmHints(states, new Set())).toBe(states);
  });
});
