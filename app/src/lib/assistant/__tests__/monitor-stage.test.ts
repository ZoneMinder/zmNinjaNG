import { describe, it, expect } from 'vitest';
import { scanMonitorMentions, resolveMonitorMention, buildMonitorSystemLine } from '../monitor-stage';
import type { MonitorRosterEntry } from '../monitor-stage';

const roster: MonitorRosterEntry[] = [
  { id: '1', name: 'Garage Outdoor' },
  { id: '2', name: 'Driveway' },
  { id: '3', name: 'Front Door' },
];

describe('scanMonitorMentions', () => {
  it('finds a monitor named verbatim in the question', () => {
    expect(scanMonitorMentions('show me the driveway today', roster)).toEqual([{ id: '2', name: 'Driveway' }]);
  });

  // Models and users both mangle spacing and case; the scan matches on the
  // same normalized key resolveMonitorRef uses for model-supplied names.
  it('matches ignoring case, spacing, and punctuation', () => {
    expect(scanMonitorMentions('anything on FRONTDOOR?', roster)).toEqual([{ id: '3', name: 'Front Door' }]);
    expect(scanMonitorMentions('check front-door please', roster)).toEqual([{ id: '3', name: 'Front Door' }]);
  });

  it('finds every mentioned monitor, in roster order', () => {
    expect(scanMonitorMentions('compare front door and driveway', roster)).toEqual([
      { id: '2', name: 'Driveway' },
      { id: '3', name: 'Front Door' },
    ]);
  });

  it('finds nothing when the question names no monitor', () => {
    expect(scanMonitorMentions('how many people came by yesterday', roster)).toEqual([]);
  });

  // A monitor whose name normalizes to '' (all punctuation) must never match
  // every question by matching the empty string.
  it('ignores a monitor whose normalized name is empty', () => {
    expect(scanMonitorMentions('summarize today', [{ id: '9', name: '***' }])).toEqual([]);
  });
});

describe('resolveMonitorMention', () => {
  it('resolves a single scan hit deterministically, ignoring the model verdict', () => {
    expect(resolveMonitorMention([roster[1]], 'NO_MATCH', roster)).toEqual({
      kind: 'resolved',
      id: '2',
      name: 'Driveway',
    });
  });

  // Two named monitors: the model handles them itself (one call each); pinning
  // one would hide the other.
  it('resolves multiple scan hits to none', () => {
    expect(resolveMonitorMention([roster[0], roster[1]], undefined, roster)).toEqual({ kind: 'none' });
  });

  it('maps a triage monitor name to its roster entry', () => {
    expect(resolveMonitorMention([], 'Garage Outdoor', roster)).toEqual({
      kind: 'resolved',
      id: '1',
      name: 'Garage Outdoor',
    });
  });

  it('maps NO_MATCH to no_match and NONE to none', () => {
    expect(resolveMonitorMention([], 'NO_MATCH', roster)).toEqual({ kind: 'no_match' });
    expect(resolveMonitorMention([], 'NONE', roster)).toEqual({ kind: 'none' });
  });

  // The enum constrains capable backends, but an unconstrained one can reply
  // anything; a name outside the roster must not be trusted.
  it('treats an unknown or missing verdict as none', () => {
    expect(resolveMonitorMention([], 'Backyard', roster)).toEqual({ kind: 'none' });
    expect(resolveMonitorMention([], undefined, roster)).toEqual({ kind: 'none' });
  });
});

describe('buildMonitorSystemLine', () => {
  it('names the resolved monitor and its id', () => {
    const line = buildMonitorSystemLine({ kind: 'resolved', id: '2', name: 'Driveway' });
    expect(line).toContain('"2"');
    expect(line).toContain('Driveway');
    expect(line).toContain('monitorId');
  });

  it('tells the model no camera covers the named place on no_match', () => {
    const line = buildMonitorSystemLine({ kind: 'no_match' });
    expect(line).toContain('No monitor');
    expect(line).toContain('never');
  });

  it('is empty when no place was named', () => {
    expect(buildMonitorSystemLine({ kind: 'none' })).toBe('');
  });
});
