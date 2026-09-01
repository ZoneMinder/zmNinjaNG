import { describe, it, expect } from 'vitest';
import { planToolCalls } from '../plan';
import type { MonitorRosterEntry } from '../monitor-stage';

const frontDoor: MonitorRosterEntry = { id: '3', name: 'FrontDoor' };
const frontYard: MonitorRosterEntry = { id: '4', name: 'Front Yard' };

describe('planToolCalls', () => {
  // The live case (refs #432): "how may folks came to the front of my house
  // between mon and tue?" with the front cameras resolved and "folks" mapped
  // to person. The plan must pin BOTH monitors and carry the object filter,
  // with no model round choosing anything.
  it('plans one list_events per monitor of a group, carrying when, objectType, and the group label', () => {
    const calls = planToolCalls({
      kind: 'zoneminder',
      subject: 'events',
      groups: [{ label: 'the front', monitors: [frontDoor, frontYard] }],
      objects: ['person'],
      phrases: ['between mon and tue'],
    });
    expect(calls).toEqual([
      { name: 'list_events', input: { when: 'between mon and tue', monitorId: '3', objectType: 'person' }, group: 'the front' },
      { name: 'list_events', input: { when: 'between mon and tue', monitorId: '4', objectType: 'person' }, group: 'the front' },
    ]);
  });

  // Refs #446, observed live: "front vs back last week" bent into a time
  // comparison because places could not fan out. Two groups, one window.
  it('plans a place comparison as one window across two groups', () => {
    const calls = planToolCalls({
      kind: 'zoneminder',
      subject: 'events',
      groups: [
        { label: 'front of my house', monitors: [frontDoor, frontYard] },
        { label: 'back of my house', monitors: [{ id: '2', name: 'Backyard(JPEG)' }] },
      ],
      objects: [],
      phrases: ['last week'],
    });
    expect(calls).toEqual([
      { name: 'list_events', input: { when: 'last week', monitorId: '3' }, group: 'front of my house' },
      { name: 'list_events', input: { when: 'last week', monitorId: '4' }, group: 'front of my house' },
      { name: 'list_events', input: { when: 'last week', monitorId: '2' }, group: 'back of my house' },
    ]);
  });

  it('plans one unpinned call when no monitor was resolved', () => {
    expect(
      planToolCalls({ kind: 'zoneminder', subject: 'events', groups: [], objects: [], phrases: ['today'] }),
    ).toEqual([{ name: 'list_events', input: { when: 'today' } }]);
  });

  it('plans one call per timeframe for a comparison', () => {
    const calls = planToolCalls({
      kind: 'zoneminder',
      subject: 'events',
      groups: [],
      objects: [],
      phrases: ['may', 'june'],
    });
    expect(calls).toEqual([
      { name: 'list_events', input: { when: 'may' } },
      { name: 'list_events', input: { when: 'june' } },
    ]);
  });

  it('passes several objects through as an array', () => {
    const calls = planToolCalls({
      kind: 'zoneminder',
      subject: 'events',
      groups: [],
      objects: ['car', 'truck'],
      phrases: ['today'],
    });
    expect(calls).toEqual([{ name: 'list_events', input: { when: 'today', objectType: ['car', 'truck'] } }]);
  });

  it('maps the non-event subjects to their read tools', () => {
    const base = { kind: 'zoneminder' as const, groups: [], objects: [], phrases: [] };
    expect(planToolCalls({ ...base, subject: 'server' })).toEqual([{ name: 'get_server_health', input: {} }]);
    expect(planToolCalls({ ...base, subject: 'monitors' })).toEqual([{ name: 'list_monitors', input: {} }]);
    expect(planToolCalls({ ...base, subject: 'groups' })).toEqual([{ name: 'list_groups', input: {} }]);
  });

  // A null plan means "today's loop, unchanged": the fallback for anything
  // the slots do not determine.
  it('returns null when the slots determine no plan', () => {
    const base = { groups: [], objects: [], phrases: ['today'] };
    expect(planToolCalls({ kind: 'chat', subject: 'events', ...base })).toBeNull();
    expect(planToolCalls({ kind: 'zoneminder', subject: 'other', ...base })).toBeNull();
    expect(planToolCalls({ kind: 'zoneminder', subject: undefined, ...base })).toBeNull();
    expect(planToolCalls({ kind: 'zoneminder', subject: 'events', groups: [], objects: [], phrases: [] })).toBeNull();
  });

  it('returns null rather than a call explosion', () => {
    const monitors = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `m${i}` }));
    expect(
      planToolCalls({ kind: 'zoneminder', subject: 'events', groups: [{ label: 'all', monitors }], objects: [], phrases: ['may', 'june'] }),
    ).toBeNull();
  });
});

import { mergePlannedEventResults, mergePlannedEventResultsByGroup } from '../plan';

/**
 * Refs #436, observed live: two per-monitor results reached the model
 * separately; the answer summed totals itself and quoted only one monitor's
 * objectCounts and busiest hour (5 where the combined truth was 8). Same
 * window, same filter, different monitorId merges into ONE result the model
 * can only quote.
 */
describe('mergePlannedEventResults', () => {
  const call = (id: string, monitorId: string, group?: string) => ({
    id,
    name: 'list_events',
    input: { when: 'over the week', monitorId, objectType: ['person'] },
    ...(group ? { group } : {}),
  });
  const output = (monitor: string, ids: number[], hours: Record<string, number>, objects: Record<string, number>) =>
    JSON.stringify({
      summary: 'per-call summary',
      window: { from: 'Aug 25, 12:38:12 PM', to: 'Sep 1, 12:38:12 PM' },
      matchCount: ids.length,
      countsByMonitor: { [monitor]: ids.length },
      objectCounts: objects,
      countsByHour: hours,
      events: ids.map((id) => ({ id: String(id), monitor, start: 'x', durationSec: 30, objects: ['person'] })),
    });
  const ok = (out: string) => ({ callId: 'c', output: out, isError: false as const });

  it('merges counts, hours, and rows into one result with a code-built summary', () => {
    const merged = mergePlannedEventResults(
      [call('planned-1', '1'), call('planned-2', '4')],
      [
        ok(output('FrontDoor', [5, 3, 1], { 'Aug 25, 1:00:00 PM': 3 }, { person: 5 })),
        ok(output('Front Yard', [6, 4, 2], { 'Aug 25, 1:00:00 PM': 5, 'Aug 31, 6:00:00 PM': 1 }, { person: 8, truck: 3 })),
      ],
    );
    expect(merged).not.toBeNull();
    const body = JSON.parse(merged!.result.output);
    expect(body.matchCount).toBe(6);
    expect(body.countsByMonitor).toEqual({ FrontDoor: 3, 'Front Yard': 3 });
    expect(body.objectCounts).toEqual({ person: 13, truck: 3 });
    expect(body.busiestHour).toEqual({ label: 'Aug 25, 1:00:00 PM', count: 8 });
    // Rows merged newest-first by id (ZoneMinder ids are monotonic).
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(body.summary).toContain('6 events');
    expect(body.summary).toContain('person 13');
    // The synthetic call names the shared window and filter, without a
    // single-monitor pin it did not have.
    expect(merged!.call.input).toMatchObject({ when: 'over the week' });
    expect(merged!.call.input.monitorId).toBeUndefined();
  });

  // Refs #446: same window, different GROUPS must merge per group, never
  // across - a cross-group merge would erase the comparison.
  it('merges per group, labeling each merged result with its place', () => {
    const merged = mergePlannedEventResultsByGroup(
      [call('planned-1', '3', 'front'), call('planned-2', '4', 'front'), call('planned-3', '2', 'back')],
      [
        ok(output('FrontDoor', [5], { h: 1 }, { person: 5 })),
        ok(output('Front Yard', [6], { h: 1 }, { person: 6 })),
        ok(output('Backyard(JPEG)', [7], { h: 1 }, { person: 7 })),
      ],
    );
    expect(merged).not.toBeNull();
    expect(merged!.calls).toHaveLength(2);
    const front = JSON.parse(merged!.results[0].output);
    const back = JSON.parse(merged!.results[1].output);
    expect(front.place).toBe('front');
    expect(front.matchCount).toBe(2);
    expect(front.countsByMonitor).toEqual({ FrontDoor: 1, 'Front Yard': 1 });
    expect(back.place).toBe('back');
    expect(back.countsByMonitor).toEqual({ 'Backyard(JPEG)': 1 });
  });

  it('declines to merge a single call, mixed windows, or an errored result', () => {
    const a = call('planned-1', '1');
    const b = { ...call('planned-2', '4'), input: { when: 'yesterday', monitorId: '4', objectType: ['person'] } };
    expect(mergePlannedEventResults([a], [ok(output('FrontDoor', [1], {}, {}))])).toBeNull();
    expect(
      mergePlannedEventResults([a, b], [ok(output('FrontDoor', [1], {}, {})), ok(output('Front Yard', [2], {}, {}))]),
    ).toBeNull();
    expect(
      mergePlannedEventResults(
        [a, call('planned-2', '4')],
        [ok(output('FrontDoor', [1], {}, {})), { callId: 'c', output: 'boom', isError: true }],
      ),
    ).toBeNull();
  });

  it('omits objectCounts and busiestHour when any source result lacks them', () => {
    const noCounts = JSON.stringify({
      summary: 's',
      window: { from: 'a', to: 'b' },
      matchCount: 30,
      countsByMonitor: { Backyard: 30 },
      events: [],
    });
    const merged = mergePlannedEventResults(
      [call('planned-1', '1'), call('planned-2', '4')],
      [ok(output('FrontDoor', [5], { h: 1 }, { person: 5 })), ok(noCounts)],
    );
    const body = JSON.parse(merged!.result.output);
    expect(body.matchCount).toBe(31);
    expect(body.objectCounts).toBeUndefined();
    expect(body.busiestHour).toBeUndefined();
  });
});
