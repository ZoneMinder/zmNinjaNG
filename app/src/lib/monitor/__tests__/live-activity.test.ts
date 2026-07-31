import { describe, it, expect } from 'vitest';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  applyLiveAlarmHints,
  recordCleared,
  releaseDismissed,
  sameMonitorOrder,
  type ActiveMonitorEntry,
} from '../live-activity';
import type { MonitorAlarmState } from '../alarm-state';
import { LIVE_ACTIVITY } from '../../zmninja-ng-constants';

const DWELL = 30_000;
const GRACE = LIVE_ACTIVITY.episodeGraceSeconds * 1000;

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

  it('re-alarms in place rather than re-entering the monitor', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const cooling = reduceActiveMonitors(first, { '1': 'idle' }, 5000, DWELL);
    const reArmed = reduceActiveMonitors(cooling, { '1': 'alarm' }, 9000, DWELL);
    expect(reArmed.map((e) => e.monitorId)).toEqual(['1']);
    expect(reArmed[0].enteredAt).toBe(1000);
    expect(reArmed[0].isCooling).toBe(false);
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

  it('re-sorts a cooling monitor back to the top when it alarms again after a real lull', () => {
    // The lull has to clear the episode grace window. A monitor that blips
    // back into alarm a second after going quiet is the same event winding
    // down, not a new one, and the next three tests pin that.
    let list = reduceActiveMonitors([], { a: 'alarm', b: 'idle' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'idle', b: 'alarm' }, 2000, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['b', 'a']);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, 1000 + GRACE + 1, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['a', 'b']);
    expect(list[0].episodeStartedAt).toBe(1000 + GRACE + 1);
    // b never stopped alarming, so its episode is still the one that began at
    // 2000 rather than being restamped to now.
    expect(list[1].episodeStartedAt).toBe(2000);
  });

  it('holds the order steady through a sustained alarm', () => {
    // Both alarm without interruption for a full minute. Nothing about who is
    // on top has changed, so nothing may move.
    let list = reduceActiveMonitors([], { a: 'alarm' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, 2000, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['b', 'a']);
    for (let t = 3000; t <= 63_000; t += 1000) {
      list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, t, DWELL);
      expect(list.map((e) => e.monitorId)).toEqual(['b', 'a']);
    }
  });

  it('holds the order steady while two monitors flap through an event tail', () => {
    // ZoneMinder walks a winding-down event alarm -> alert -> tape -> alarm,
    // and only alarm and alert count as alarming, so each monitor drops out of
    // the alarming set and rejoins it every second or so. Sorting on a key
    // restamped every pass made the two tiles trade places on almost every
    // tick; the episode key must leave them where they are.
    let list = reduceActiveMonitors([], { a: 'alarm', b: 'alarm' }, 1000, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['a', 'b']);
    const tail: Array<[MonitorAlarmState, MonitorAlarmState]> = [
      ['tape', 'alert'],
      ['alert', 'tape'],
      ['tape', 'alert'],
      ['alert', 'alert'],
      ['tape', 'alert'],
      ['alert', 'tape'],
      ['alarm', 'alarm'],
    ];
    tail.forEach(([a, b], i) => {
      list = reduceActiveMonitors(list, { a, b }, 2000 + i * 1000, DWELL);
      expect(list.map((e) => e.monitorId)).toEqual(['a', 'b']);
    });
    // The tail must not have bumped either episode start off its original tick.
    expect(list.map((e) => e.episodeStartedAt)).toEqual([1000, 1000]);
  });

  it('promotes a long-quiet monitor to the top when it genuinely alarms again', () => {
    // a alarms, goes quiet for longer than the grace window while b keeps
    // alarming, then alarms again. That is a new event, so a takes the top
    // tile even though b has been alarming the whole time.
    let list = reduceActiveMonitors([], { a: 'alarm', b: 'idle' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'idle', b: 'alarm' }, 2000, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['b', 'a']);
    // Still quiet one tick before the grace window closes: no promotion yet.
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, 1000 + GRACE, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['b', 'a']);
    // Quiet again, then a real re-alarm past the window.
    list = reduceActiveMonitors(list, { a: 'idle', b: 'alarm' }, 1000 + GRACE + 1000, DWELL);
    const realarmAt = 1000 + GRACE * 2 + 2000;
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, realarmAt, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['a', 'b']);
    expect(list[0].episodeStartedAt).toBe(realarmAt);
  });

  it('keeps surviving monitors in place when one in the middle expires', () => {
    let list: ActiveMonitorEntry[] = [];
    list = reduceActiveMonitors(list, { a: 'alarm' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, 2000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm', c: 'alarm' }, 3000, DWELL);
    // Newest episode on top, so the arrival order is reversed.
    expect(list.map((e) => e.monitorId)).toEqual(['c', 'b', 'a']);
    // b goes idle and expires; a and c stay alarming and must not swap.
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'idle', c: 'alarm' }, 3000 + DWELL + 1, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['c', 'a']);
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

  it('records the cause an entering monitor was reported with', () => {
    const next = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL, {
      causes: new Map([['1', 'Motion: All']]),
    });
    expect(next[0].cause).toBe('Motion: All');
  });

  it('leaves the cause unset when the notification stream has said nothing', () => {
    // The cause is present-when-known: alarm state comes from polling, which
    // never carries one.
    const next = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    expect(next[0].cause).toBeUndefined();
  });

  it('adopts a cause that arrives after the alarm was already polled', () => {
    const polled = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const withCause = reduceActiveMonitors(polled, { '1': 'alarm' }, 2000, DWELL, {
      causes: new Map([['1', 'Forced Web']]),
    });
    expect(withCause[0].cause).toBe('Forced Web');
  });

  it('keeps the cause after the notification has aged out of the hint window', () => {
    // The events feeding the cause map expire on their own schedule; a tile
    // that keeps alarming must not lose its label halfway through.
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL, {
      causes: new Map([['1', 'Motion: All']]),
    });
    const later = reduceActiveMonitors(first, { '1': 'alarm' }, 2000, DWELL);
    const cooling = reduceActiveMonitors(later, { '1': 'idle' }, 3000, DWELL);
    expect(later[0].cause).toBe('Motion: All');
    expect(cooling[0].cause).toBe('Motion: All');
  });

  it('takes the new cause when a genuinely new episode starts', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL, {
      causes: new Map([['1', 'Motion: All']]),
    });
    const cooling = reduceActiveMonitors(first, { '1': 'idle' }, 2000, DWELL);
    const newEpisode = reduceActiveMonitors(
      cooling,
      { '1': 'alarm' },
      2000 + GRACE + 1,
      DWELL,
      { causes: new Map([['1', 'Forced Web']]) }
    );
    expect(newEpisode[0].cause).toBe('Forced Web');
    expect(newEpisode[0].episodeStartedAt).toBe(2000 + GRACE + 1);
  });

  it('treats a blank cause as no cause at all', () => {
    const next = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL, {
      causes: new Map([['1', '  ']]),
    });
    expect(next[0].cause).toBeUndefined();
  });

  it('returns the same array reference when the cause map is rebuilt unchanged', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL, {
      causes: new Map([['1', 'Motion: All']]),
    });
    const again = reduceActiveMonitors(first, { '1': 'alarm' }, 1000, DWELL, {
      causes: new Map([['1', 'Motion: All']]),
    });
    expect(again).toBe(first);
  });

  it('drops a dismissed monitor and keeps it out while it is still alarming', () => {
    // The whole point of the dismissed set: without it the reducer readmits a
    // still-alarming monitor on the very next poll and the control reads as
    // broken on the first click.
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const dismissed = new Set(['1']);
    const gone = reduceActiveMonitors(first, { '1': 'alarm' }, 2000, DWELL, { dismissed });
    expect(gone).toEqual([]);
    const stillGone = reduceActiveMonitors(gone, { '1': 'alarm' }, 3000, DWELL, { dismissed });
    expect(stillGone).toEqual([]);
  });

  it('lets a dismissed monitor back in once the dismissal has been released', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const gone = reduceActiveMonitors(first, { '1': 'alarm' }, 2000, DWELL, {
      dismissed: new Set(['1']),
    });
    const backLater = reduceActiveMonitors(gone, { '1': 'alarm' }, 90_000, DWELL);
    expect(backLater.map((e) => e.monitorId)).toEqual(['1']);
    // A separate later alarm, so it enters as a fresh episode rather than
    // resuming the dismissed one.
    expect(backLater[0].episodeStartedAt).toBe(90_000);
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
    episodeStartedAt: 0,
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

describe('sameMonitorOrder', () => {
  const make = (id: string, isCooling = false): ActiveMonitorEntry => ({
    monitorId: id,
    state: isCooling ? 'idle' : 'alarm',
    enteredAt: 0,
    lastAlarmingAt: 0,
    episodeStartedAt: 0,
    isCooling,
  });

  it('is true when the same monitors sit in the same slots', () => {
    // What the page uses to decide whether a change is worth animating: a
    // state change in place must not trigger a reorder transition.
    expect(sameMonitorOrder([make('1'), make('2')], [make('1'), make('2', true)])).toBe(true);
  });

  it('is false when two monitors swap places', () => {
    expect(sameMonitorOrder([make('1'), make('2')], [make('2'), make('1')])).toBe(false);
  });

  it('is false when a monitor joins or leaves', () => {
    expect(sameMonitorOrder([make('1')], [make('1'), make('2')])).toBe(false);
    expect(sameMonitorOrder([make('1'), make('2')], [make('1')])).toBe(false);
  });
});

describe('recordCleared', () => {
  const CLEARED_AGE = LIVE_ACTIVITY.clearedMaxAgeSeconds * 1000;

  it('records what just left, newest first', () => {
    const first = recordCleared([], ['1'], 1000);
    const second = recordCleared(first, ['2'], 2000);
    expect(second.map((c) => c.monitorId)).toEqual(['2', '1']);
    expect(second[0].clearedAt).toBe(2000);
  });

  it('hands back the same array when nothing left and nothing expired', () => {
    // It renders under the grid, so a new array on every poll tick would be a
    // re-render for a list that did not change.
    const first = recordCleared([], ['1'], 1000);
    expect(recordCleared(first, [], 2000)).toBe(first);
  });

  it('moves a monitor that leaves twice rather than listing it twice', () => {
    const first = recordCleared([], ['1', '2'], 1000);
    const again = recordCleared(first, ['1'], 5000);
    expect(again.map((c) => c.monitorId)).toEqual(['1', '2']);
    expect(again[0].clearedAt).toBe(5000);
  });

  it('keeps the strip bounded in count', () => {
    const ids = Array.from({ length: LIVE_ACTIVITY.clearedMaxItems + 3 }, (_, i) => `m${i}`);
    const cleared = recordCleared([], ids, 1000);
    expect(cleared).toHaveLength(LIVE_ACTIVITY.clearedMaxItems);
  });

  it('drops entries older than the age bound', () => {
    const first = recordCleared([], ['1'], 1000);
    expect(recordCleared(first, [], 1000 + CLEARED_AGE + 1)).toEqual([]);
  });
});

describe('releaseDismissed', () => {
  it('holds a dismissal while its monitor is still alarming', () => {
    const dismissed = new Set(['1']);
    expect(releaseDismissed(dismissed, { '1': 'alarm' })).toBe(dismissed);
    expect(releaseDismissed(dismissed, { '1': 'alert' })).toBe(dismissed);
  });

  it('releases a dismissal once its monitor has genuinely gone quiet', () => {
    // Otherwise a monitor dismissed today would never show its next alarm.
    expect(releaseDismissed(new Set(['1']), { '1': 'idle' }).size).toBe(0);
  });

  it('releases a dismissal for a monitor the page has stopped watching', () => {
    expect(releaseDismissed(new Set(['1']), {}).size).toBe(0);
  });

  it('hands back the same set when nothing was released', () => {
    // The caller keeps this in a ref and feeds it to the reducer; a fresh set
    // per pass would be a new reducer input on every poll tick.
    const empty = new Set<string>();
    expect(releaseDismissed(empty, { '1': 'alarm' })).toBe(empty);
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
