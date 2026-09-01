import { describe, it, expect, vi } from 'vitest';
import {
  scanMonitorMentions,
  resolveMonitorMention,
  buildMonitorSystemLine,
  resolveCoverage,
  buildCoveragePrompt,
  buildCoverageSchema,
  deriveMonitorGroups,
} from '../monitor-stage';
import type { MonitorRosterEntry } from '../monitor-stage';
import type { AssistantProvider } from '../types';
import { contextForTimeCall } from '../monitor-stage';

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


/**
 * The dedicated coverage call (refs #438, groups refs #446): one focused
 * interrogation returning PLACE GROUPS, so "front vs back" resolves two
 * camera sets instead of bending into a time comparison.
 */
describe('coverage call', () => {
  const roster = [
    { id: '2', name: 'Backyard(JPEG)' },
    { id: '3', name: 'FrontDoor' },
    { id: '4', name: 'Front Yard' },
  ];

  it('sends the focused prompt and constrained schema, deriving the groups', async () => {
    const provider = {
      complete: vi.fn().mockResolvedValue({
        text: '{"groups":[{"place":"front of my house","covered":true,"monitors":["FrontDoor","Front Yard"]},{"place":"back of my house","covered":true,"monitors":["Backyard(JPEG)"]}]}',
      }),
    } as unknown as AssistantProvider;
    const slots = await resolveCoverage(
      'how does the front of my house compare to the back of my house last week?',
      roster,
      provider,
      new AbortController().signal,
    );

    const [system, , , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toBe(buildCoveragePrompt(roster.map((m) => m.name)));
    expect(system).toContain('Backyard(JPEG), FrontDoor, Front Yard');
    expect(schema).toEqual(buildCoverageSchema(roster.map((m) => m.name)));
    expect(slots).toEqual({
      groups: [
        { label: 'front of my house', monitors: ['FrontDoor', 'Front Yard'] },
        { label: 'back of my house', monitors: ['Backyard(JPEG)'] },
      ],
    });
  });

  it('degrades to empty slots when the call fails', async () => {
    const provider = { complete: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AssistantProvider;
    await expect(resolveCoverage('q', roster, provider, new AbortController().signal)).resolves.toEqual({});
  });

  it('wraps the question with structured context', async () => {
    const provider = {
      complete: vi.fn().mockResolvedValue({ text: '{"groups":[{"place":"garage","covered":true,"monitors":["FrontDoor"]}]}' }),
    } as unknown as AssistantProvider;
    await resolveCoverage('what about the garage?', roster, provider, new AbortController().signal, undefined, {
      question: 'how was the rear this week?',
      monitors: ['Backyard(JPEG)'],
    });
    const [, question] = vi.mocked(provider.complete).mock.calls[0];
    expect(question).toContain('how was the rear this week?');
    expect((question as string).trim().endsWith('what about the garage?')).toBe(true);
  });
});

/** The derivation guards, per group, in code (refs #430, #432, #446). */
describe('deriveMonitorGroups', () => {
  const names = ['FrontDoor', 'Garage Outdoor'];

  it('maps covered groups, derives noMatch, and drops junk', () => {
    expect(
      deriveMonitorGroups({ groups: [{ place: 'front door', covered: true, monitors: ['FrontDoor'] }] }, names),
    ).toEqual({ groups: [{ label: 'front door', monitors: ['FrontDoor'] }] });
    expect(
      deriveMonitorGroups({ groups: [{ place: 'basement stairs', covered: false, monitors: [] }] }, names),
    ).toEqual({ noMatch: true });
    expect(deriveMonitorGroups({ groups: [] }, names)).toEqual({ groups: [] });
    expect(
      deriveMonitorGroups({ groups: [{ place: 'x', covered: true, monitors: ['Bogus'] }] }, names),
    ).toEqual({ groups: [] });
  });

  it('keeps the contradiction and whole-roster guards per group', () => {
    expect(
      deriveMonitorGroups({ groups: [{ place: 'front door', covered: false, monitors: ['FrontDoor'] }] }, names),
    ).toEqual({ groups: [] });
    expect(
      deriveMonitorGroups({ groups: [{ place: 'front door', covered: true, monitors: names }] }, names),
    ).toEqual({ groups: [] });
  });

  it('a resolvable group wins over a sibling no-cover place', () => {
    expect(
      deriveMonitorGroups(
        { groups: [{ place: 'front', covered: true, monitors: ['FrontDoor'] }, { place: 'moon', covered: false, monitors: [] }] },
        names,
      ),
    ).toEqual({ groups: [{ label: 'front', monitors: ['FrontDoor'] }] });
  });
});

describe('resolveMonitorMention', () => {
  const roster = [
    { id: '1', name: 'Garage Outdoor' },
    { id: '2', name: 'Driveway' },
    { id: '3', name: 'Front Door' },
  ];

  it('resolves scan hits as one group, ignoring the model verdict', () => {
    expect(resolveMonitorMention([roster[1]], { noMatch: true }, roster)).toEqual({
      kind: 'resolved',
      groups: [{ label: 'Driveway', monitors: [roster[1]] }],
    });
  });

  it('maps verdict groups to roster entries', () => {
    expect(
      resolveMonitorMention(
        [],
        { groups: [{ label: 'front', monitors: ['Front Door'] }, { label: 'drive', monitors: ['Driveway'] }] },
        roster,
      ),
    ).toEqual({
      kind: 'resolved',
      groups: [
        { label: 'front', monitors: [roster[2]] },
        { label: 'drive', monitors: [roster[1]] },
      ],
    });
  });

  it('maps noMatch to no_match and an empty verdict to none', () => {
    expect(resolveMonitorMention([], { noMatch: true }, roster)).toEqual({ kind: 'no_match' });
    expect(resolveMonitorMention([], { groups: [] }, roster)).toEqual({ kind: 'none' });
    expect(resolveMonitorMention([], {}, roster)).toEqual({ kind: 'none' });
  });
});

describe('buildMonitorSystemLine', () => {
  const roster = [
    { id: '1', name: 'Garage Outdoor' },
    { id: '2', name: 'Driveway' },
    { id: '3', name: 'Front Door' },
  ];

  it('names every group with its monitors and ids', () => {
    const line = buildMonitorSystemLine({
      kind: 'resolved',
      groups: [
        { label: 'front of my house', monitors: [roster[2]] },
        { label: 'back of my house', monitors: [roster[0]] },
      ],
    });
    expect(line).toContain('front of my house');
    expect(line).toContain('back of my house');
    expect(line).toContain('"3"');
    expect(line).toContain('Front Door');
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

/** Refs #446: a place comparison (two groups) keeps the previous turn's
 *  period away from the time call - measured 2/2, the windows call
 *  otherwise splits the spatial comparison across time. */
describe('contextForTimeCall', () => {
  const ctx = { question: 'hows the day?', periods: ['today'] };
  const entry = { id: '1', name: 'FrontDoor' };

  it('withholds context from a multi-group place comparison', () => {
    expect(
      contextForTimeCall(ctx, { kind: 'resolved', groups: [{ label: 'a', monitors: [entry] }, { label: 'b', monitors: [entry] }] }),
    ).toBeUndefined();
  });

  it('passes context through for single-group and unresolved turns', () => {
    expect(contextForTimeCall(ctx, { kind: 'resolved', groups: [{ label: 'a', monitors: [entry] }] })).toBe(ctx);
    expect(contextForTimeCall(ctx, { kind: 'none' })).toBe(ctx);
  });
});
