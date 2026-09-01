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

  // Refs #430, observed live: "front of my door" is not a contiguous
  // substring of any name, so the substring pass missed FrontDoor and the
  // turn fell to the model, which contradicted itself. Every token of a
  // name appearing in the question is just as deterministic a signal.
  it('matches a name whose tokens all appear in the question, words intervening', () => {
    expect(scanMonitorMentions('how many people came to the front of my door yesterday?', roster)).toEqual([
      { id: '3', name: 'Front Door' },
    ]);
  });

  it('splits camelCase names into tokens', () => {
    const camel = [{ id: '7', name: 'FrontDoor' }];
    expect(scanMonitorMentions('anything at the front of the door?', camel)).toEqual([{ id: '7', name: 'FrontDoor' }]);
  });

  // "Front Yard" shares the "front" token; only a full token set matches.
  it('does not match a name when only some of its tokens appear', () => {
    const yards = [{ id: '8', name: 'Front Yard' }];
    expect(scanMonitorMentions('who came to the front of my door', yards)).toEqual([]);
  });

  it('does not token-match on partial words', () => {
    expect(scanMonitorMentions('the doorbell rang out front', roster)).toEqual([]);
  });

  // A monitor whose name normalizes to '' (all punctuation) must never match
  // every question by matching the empty string.
  it('ignores a monitor whose normalized name is empty', () => {
    expect(scanMonitorMentions('summarize today', [{ id: '9', name: '***' }])).toEqual([]);
  });
});

describe('resolveMonitorMention', () => {
  it('resolves scan hits deterministically, ignoring the model verdict', () => {
    expect(resolveMonitorMention([roster[1]], { noMatch: true }, roster)).toEqual({
      kind: 'resolved',
      monitors: [roster[1]],
    });
  });

  // Several named monitors are a SET now (refs #432): "compare front door
  // and driveway" pins both, one planned call each.
  it('resolves multiple scan hits as a set', () => {
    expect(resolveMonitorMention([roster[0], roster[1]], {}, roster)).toEqual({
      kind: 'resolved',
      monitors: [roster[0], roster[1]],
    });
  });

  it('maps the verdict monitor names to roster entries', () => {
    expect(
      resolveMonitorMention([], { monitors: ['Garage Outdoor', 'Driveway'] }, roster),
    ).toEqual({ kind: 'resolved', monitors: [roster[0], roster[1]] });
  });

  it('maps noMatch to no_match and an empty verdict to none', () => {
    expect(resolveMonitorMention([], { noMatch: true }, roster)).toEqual({ kind: 'no_match' });
    expect(resolveMonitorMention([], { monitors: [] }, roster)).toEqual({ kind: 'none' });
    expect(resolveMonitorMention([], {}, roster)).toEqual({ kind: 'none' });
  });

  it('drops verdict names that are not in the roster', () => {
    expect(resolveMonitorMention([], { monitors: ['Backyard'] }, roster)).toEqual({
      kind: 'none',
    });
  });
});

describe('buildMonitorSystemLine', () => {
  it('names one resolved monitor and its id', () => {
    const line = buildMonitorSystemLine({ kind: 'resolved', monitors: [roster[1]] });
    expect(line).toContain('"2"');
    expect(line).toContain('Driveway');
    expect(line).toContain('monitorId');
  });

  it('names every monitor of a resolved set', () => {
    const line = buildMonitorSystemLine({ kind: 'resolved', monitors: [roster[1], roster[2]] });
    expect(line).toContain('Driveway');
    expect(line).toContain('Front Door');
    expect(line).toContain('"3"');
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
