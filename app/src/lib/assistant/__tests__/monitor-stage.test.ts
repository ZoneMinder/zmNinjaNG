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

import { resolveCoverage, buildCoveragePrompt, buildCoverageSchema, deriveMonitorSlots } from '../monitor-stage';
import type { AssistantProvider } from '../types';
import { vi } from 'vitest';

/**
 * The dedicated coverage call (refs #438). Judged inside the consolidated
 * parse prompt, place coverage failed live twice ("rear of my house" ->
 * NO_MATCH with a Backyard camera present) and every rewording rotated the
 * failures; the same model on this focused prompt measures 8/8 across every
 * failure case. One question per judgment.
 */
describe('coverage call', () => {
  const roster = [
    { id: '2', name: 'Backyard(JPEG)' },
    { id: '3', name: 'FrontDoor' },
  ];

  it('sends the focused prompt and constrained schema, deriving the slots', async () => {
    const provider = {
      complete: vi.fn().mockResolvedValue({ text: '{"place":"rear of my house","covered":true,"monitors":["Backyard(JPEG)"]}' }),
    } as unknown as AssistantProvider;
    const slots = await resolveCoverage('how was the rear of my house all this week?', roster, provider, new AbortController().signal);

    const [system, question, , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toBe(buildCoveragePrompt(roster.map((m) => m.name)));
    expect(system).toContain('Backyard(JPEG), FrontDoor');
    expect(question).toBe('how was the rear of my house all this week?');
    expect(schema).toEqual(buildCoverageSchema(roster.map((m) => m.name)));
    expect(slots).toEqual({ monitors: ['Backyard(JPEG)'] });
  });

  it('degrades to empty slots when the call fails', async () => {
    const provider = { complete: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AssistantProvider;
    await expect(resolveCoverage('q', roster, provider, new AbortController().signal)).resolves.toEqual({});
  });
});

/** The derivation guards live on, in code: they are bookkeeping over the
 *  constrained reply, not language rules (refs #430, #432, #438). */
describe('deriveMonitorSlots', () => {
  const names = ['FrontDoor', 'Garage Outdoor'];

  it('maps covered names, derives noMatch, and drops junk', () => {
    expect(deriveMonitorSlots({ place: 'front door', covered: true, monitors: ['FrontDoor'] }, names)).toEqual({
      monitors: ['FrontDoor'],
    });
    expect(deriveMonitorSlots({ place: 'basement stairs', covered: false, monitors: [] }, names)).toEqual({
      noMatch: true,
    });
    expect(deriveMonitorSlots({ place: '', covered: false, monitors: [] }, names)).toEqual({ monitors: [] });
    expect(deriveMonitorSlots({ place: 'x', covered: true, monitors: ['Bogus'] }, names)).toEqual({});
  });

  it('keeps the contradiction and whole-roster guards', () => {
    expect(deriveMonitorSlots({ place: 'front door', covered: false, monitors: ['FrontDoor'] }, names)).toEqual({});
    expect(deriveMonitorSlots({ place: 'front door', covered: true, monitors: names }, names)).toEqual({});
  });

  it('treats a time-word place as no place', () => {
    expect(deriveMonitorSlots({ place: 'today', covered: false, monitors: [] }, names)).toEqual({ monitors: [] });
  });
});
