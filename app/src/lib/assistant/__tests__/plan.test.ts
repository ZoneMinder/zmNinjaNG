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
  it('plans one list_events per resolved monitor, carrying when and objectType', () => {
    const calls = planToolCalls({
      kind: 'zoneminder',
      subject: 'events',
      monitors: [frontDoor, frontYard],
      objects: ['person'],
      phrases: ['between mon and tue'],
    });
    expect(calls).toEqual([
      { name: 'list_events', input: { when: 'between mon and tue', monitorId: '3', objectType: 'person' } },
      { name: 'list_events', input: { when: 'between mon and tue', monitorId: '4', objectType: 'person' } },
    ]);
  });

  it('plans one unpinned call when no monitor was resolved', () => {
    expect(
      planToolCalls({ kind: 'zoneminder', subject: 'events', monitors: [], objects: [], phrases: ['today'] }),
    ).toEqual([{ name: 'list_events', input: { when: 'today' } }]);
  });

  it('plans one call per timeframe for a comparison', () => {
    const calls = planToolCalls({
      kind: 'zoneminder',
      subject: 'events',
      monitors: [],
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
      monitors: [],
      objects: ['car', 'truck'],
      phrases: ['today'],
    });
    expect(calls).toEqual([{ name: 'list_events', input: { when: 'today', objectType: ['car', 'truck'] } }]);
  });

  it('maps the non-event subjects to their read tools', () => {
    const base = { kind: 'zoneminder' as const, monitors: [], objects: [], phrases: [] };
    expect(planToolCalls({ ...base, subject: 'server' })).toEqual([{ name: 'get_server_health', input: {} }]);
    expect(planToolCalls({ ...base, subject: 'monitors' })).toEqual([{ name: 'list_monitors', input: {} }]);
    expect(planToolCalls({ ...base, subject: 'groups' })).toEqual([{ name: 'list_groups', input: {} }]);
  });

  // A null plan means "today's loop, unchanged": the fallback for anything
  // the slots do not determine.
  it('returns null when the slots determine no plan', () => {
    const base = { monitors: [], objects: [], phrases: ['today'] };
    expect(planToolCalls({ kind: 'chat', subject: 'events', ...base })).toBeNull();
    expect(planToolCalls({ kind: 'zoneminder', subject: 'other', ...base })).toBeNull();
    expect(planToolCalls({ kind: 'zoneminder', subject: undefined, ...base })).toBeNull();
    expect(planToolCalls({ kind: 'zoneminder', subject: 'events', monitors: [], objects: [], phrases: [] })).toBeNull();
  });

  it('returns null rather than a call explosion', () => {
    const monitors = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `m${i}` }));
    expect(
      planToolCalls({ kind: 'zoneminder', subject: 'events', monitors, objects: [], phrases: ['may', 'june'] }),
    ).toBeNull();
  });
});
